from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi import WebSocket, WebSocketDisconnect # 🛠️ NEW IMPORT AT THE TOP!
import cv2
import numpy as np
import json # 🛠️ MAKE SURE YOU ADD THIS IMPORT AT THE TOP!

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================================
# ENGINE 1: THE BLUEPRINT CONVERTER (2D to 3D)
# ==========================================================

@app.post("/process-blueprint/")
async def process_blueprint(file: UploadFile = File(...)):
    print(f"🔥 RECEIVED BLUEPRINT: {file.filename}")
    
    # 1. Convert the uploaded image into a format OpenCV can read
    image_bytes = await file.read()
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # 2. PRE-PROCESSING (Clean the image)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # 3. EDGE DETECTION (Find the borders)
    edges = cv2.Canny(blurred, 50, 150)

    # 4. HOUGH LINE TRANSFORM (Pixels to Math)
    lines = cv2.HoughLinesP(
        edges, 
        rho=1, 
        theta=np.pi / 180, 
        threshold=100, 
        minLineLength=80,  
        maxLineGap=10      
    )

    walls_data = []
    
    # 5. SCALE AND FORMAT FOR REACT NATIVE
    if lines is not None:
        print(f"📐 Found {len(lines)} wall segments!")
        scale_factor = 100.0 
        
        height, width = img.shape[:2]
        center_x, center_y = width / 2, height / 2

        for line in lines[:50]:
            x1, y1, x2, y2 = line[0]
            start_x = (x1 - center_x) / scale_factor
            start_z = (y1 - center_y) / scale_factor
            end_x = (x2 - center_x) / scale_factor
            end_z = (y2 - center_y) / scale_factor

            walls_data.append({
                "start": [float(start_x), float(start_z)],
                "end": [float(end_x), float(end_z)]
            })
    else:
        print("❌ No lines detected in this image.")

    return {
        "status": "success",
        "walls": walls_data,
        "wall_height": 2.5
    }


# ==========================================================
# ENGINE 2: THE MINI-SLAM OPTICAL FLOW TRACKER
# ==========================================================

# Global state to remember the past frame and the pixels we are tracking
previous_gray_frame = None
tracked_points = None

# Optical Flow Configuration Parameters (Thesis Material!)
feature_params = dict(maxCorners=100, qualityLevel=0.3, minDistance=7, blockSize=7)
lk_params = dict(winSize=(15, 15), maxLevel=2, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03))

@app.post("/slam-track/")
async def slam_track(file: UploadFile = File(...)):
    global previous_gray_frame, tracked_points
    
    try:
        # 1. Read the incoming image
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE) 
        
        # 🛠️ BUG FIX 1: Force exact dimensions so OpenCV never crashes on rotation
        img = cv2.resize(img, (640, 480))
        
        if previous_gray_frame is None or tracked_points is None or len(tracked_points) < 10:
            previous_gray_frame = img
            tracked_points = cv2.goodFeaturesToTrack(img, mask=None, **feature_params)
            return JSONResponse(content={"status": "initializing", "dx": 0.0, "dy": 0.0})
        
        new_points, status, error = cv2.calcOpticalFlowPyrLK(
            previous_gray_frame, img, tracked_points, None, **lk_params
        )

        good_new = new_points[status == 1]
        good_old = tracked_points[status == 1]

        if len(good_new) > 0:
            dxs = good_new[:, 0] - good_old[:, 0]
            dys = good_new[:, 1] - good_old[:, 1]

            dx_pixel = float(np.median(dxs))
            dy_pixel = float(np.median(dys))

            # 🛠️ NEW: THE DEADZONE (Fixes the bouncing when standing still)
            # If the pixel shift is tiny, it's just hand-shake noise. Force it to 0.
            if abs(dx_pixel) < 1.5:
                dx_pixel = 0.0
            if abs(dy_pixel) < 1.5:
                dy_pixel = 0.0

            # 🛠️ BUG FIX 2: THE SPEED LIMIT (Ignore massive motion blur jumps)
            if abs(dx_pixel) > 60.0 or abs(dy_pixel) > 60.0:
                print(f"🏎️ Ignored Motion Blur! Speed: {dx_pixel:.1f}, {dy_pixel:.1f}")
                dx_pixel = 0.0
                dy_pixel = 0.0

            # 🛠️ MEMORY OVERWRITE (The "Trash" function)
            # This completely deletes the old image from RAM and saves the new one
            previous_gray_frame = img.copy()
            tracked_points = good_new.reshape(-1, 1, 2)
            
            # Print to terminal so you can monitor it!
            if dx_pixel != 0 or dy_pixel != 0:
                print(f"🚶 SLAM Tracked: dx={dx_pixel:.2f}, dy={dy_pixel:.2f}")
            
            return JSONResponse(content={"status": "success", "dx": dx_pixel, "dy": dy_pixel})
        else:
            tracked_points = None
            return JSONResponse(content={"status": "lost", "dx": 0.0, "dy": 0.0})
        
    except Exception as e:
        print(f"❌ SLAM Error: {str(e)}")
        return JSONResponse(content={"status": "error", "message": str(e)})

@app.post("/slam-reset/")
async def slam_reset():
    global previous_gray_frame, tracked_points
    previous_gray_frame = None
    tracked_points = None
    print("🔄 SLAM Engine Reset manually.")
    return JSONResponse(content={"status": "success", "message": "Tracker reset."})


@app.websocket("/slam-ws/")
async def slam_ws(websocket: WebSocket):
    global previous_gray_frame, tracked_points
    
    await websocket.accept()
    print("🟢 WEBSOCKET CONNECTED: X-Ray Mode Engaged!")
    
    try:
        while True:
            imu_data_str = await websocket.receive_text()
            imu = json.loads(imu_data_str)
            gyro_x = imu.get("gyro_x", 0.0)
            gyro_y = imu.get("gyro_y", 0.0)
            
            contents = await websocket.receive_bytes()
            
            nparr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE) 
            img = cv2.resize(img, (640, 480))
            
            # Create a color version of the image just for our X-Ray screen
            debug_frame = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            
            if abs(gyro_x) > 0.25 or abs(gyro_y) > 0.25:
                # User is rotating! Draw a warning on the screen!
                cv2.putText(debug_frame, "IMU ROTATION BLOCKED!", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                
                previous_gray_frame = img.copy()
                if tracked_points is not None:
                    tracked_points = cv2.goodFeaturesToTrack(img, mask=None, **feature_params)
                
                await websocket.send_json({"status": "success", "dx": 0.0, "dy": 0.0})
                
                cv2.imshow("SIMULA67 X-Ray Debugger", debug_frame)
                cv2.waitKey(1)
                continue
            
            if previous_gray_frame is None or tracked_points is None or len(tracked_points) < 10:
                previous_gray_frame = img
                tracked_points = cv2.goodFeaturesToTrack(img, mask=None, **feature_params)
                await websocket.send_json({"status": "initializing", "dx": 0.0, "dy": 0.0})
                
                cv2.putText(debug_frame, "INITIALIZING FEATURES...", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
                cv2.imshow("SIMULA67 X-Ray Debugger", debug_frame)
                cv2.waitKey(1)
                continue
            
            new_points, status, error = cv2.calcOpticalFlowPyrLK(
                previous_gray_frame, img, tracked_points, None, **lk_params
            )

            good_new = new_points[status == 1]
            good_old = tracked_points[status == 1]

            # 🛠️ THE RANSAC FILTER & X-RAY DRAWING BOARD
            # We need at least 4 points to run the RANSAC democratic vote
            if len(good_new) >= 4: 
                
                # THE HOLY GRAIL: This function calculates the absolute perfect movement, 
                # and creates a mask separating the sober points from the drunk points!
                transform_matrix, inliers = cv2.estimateAffinePartial2D(
                    good_old, good_new, method=cv2.RANSAC, ransacReprojThreshold=3.0
                )

                if transform_matrix is not None:
                    # The matrix holds our clean X and Y movement!
                    dx_pixel = float(transform_matrix[0, 2])
                    dy_pixel = float(transform_matrix[1, 2])
                    
                    # Separate the good data from the bad data
                    inlier_mask = inliers.ravel() == 1
                    sober_new = good_new[inlier_mask]
                    sober_old = good_old[inlier_mask]
                    drunk_new = good_new[~inlier_mask]
                    
                    # 1. Draw the SOBER tracking lines in Green
                    for new, old in zip(sober_new, sober_old):
                        a, b = int(new[0]), int(new[1])
                        c, d = int(old[0]), int(old[1])
                        debug_frame = cv2.line(debug_frame, (a, b), (c, d), (0, 255, 0), 2)
                        debug_frame = cv2.circle(debug_frame, (a, b), 5, (0, 255, 0), -1)

                    # 2. Draw the DRUNK points in Red (No lines, just the dots we rejected!)
                    for drunk in drunk_new:
                        a, b = int(drunk[0]), int(drunk[1])
                        debug_frame = cv2.circle(debug_frame, (a, b), 5, (0, 0, 255), -1)

                    # Deadzones & Speed limits
                    if abs(dx_pixel) < 3: dx_pixel = 0.0
                    if abs(dy_pixel) < 3: dy_pixel = 0.0
                    if abs(dx_pixel) > 60.0 or abs(dy_pixel) > 60.0:
                        dx_pixel = 0.0
                        dy_pixel = 0.0

                    previous_gray_frame = img.copy()
                    
                    # ⚠️ CRITICAL: We only save the SOBER points for the next frame.
                    # We permanently throw away the bad ones!
                    tracked_points = sober_new.reshape(-1, 1, 2)
                    
                    # Update the X-Ray text to show us the filter working
                    cv2.putText(debug_frame, f"SOBER: {len(sober_new)} | DRUNK: {len(drunk_new)}", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                    await websocket.send_json({"status": "success", "dx": dx_pixel, "dy": dy_pixel})
                
                else:
                    # If RANSAC fails to find a majority, the frame is too blurry. Toss it!
                    tracked_points = None
                    cv2.putText(debug_frame, "RANSAC FAILED! TOO BLURRY!", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                    await websocket.send_json({"status": "lost", "dx": 0.0, "dy": 0.0})
            
            else:
                # Less than 4 points? We lost tracking.
                tracked_points = None
                cv2.putText(debug_frame, "TRACKING LOST!", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                await websocket.send_json({"status": "lost", "dx": 0.0, "dy": 0.0})
            
            # Save the frame to our X-Ray file
            cv2.imwrite("xray_debug.jpg", debug_frame)
                
    except WebSocketDisconnect:
        print("🔴 WEBSOCKET DISCONNECTED")
        previous_gray_frame = None
        tracked_points = None