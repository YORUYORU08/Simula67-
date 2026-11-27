import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { Gyroscope } from 'expo-sensors'; 

const WS_URL = "ws://192.168.100.184:8000/slam-ws/"; 

export default function SlamScreen({ navigation }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const [isActive, setIsActive] = useState(true);
  const device = useCameraDevice('back');
  const cameraRef = useRef(null);

  const [positionX, setPositionX] = useState(0.0);
  const [positionZ, setPositionZ] = useState(0.0);
  
  const ws = useRef(null);
  const isProcessing = useRef(false);
  const currentGyro = useRef({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  useEffect(() => {
    Gyroscope.setUpdateInterval(50); 
    const subscription = Gyroscope.addListener(gyroData => {
      currentGyro.current = gyroData;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    ws.current = new WebSocket(WS_URL);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // 3. Update the Coordinates!
        if (data.status === 'success') {
          // 🛠️ BUG FIX: Dial down the sensitivity! 
          // 0.002 means 500 pixels of shift = 1 meter.
          const scaleFactor = 0.002; 
          setPositionX((prev) => prev + (data.dx * scaleFactor));
          setPositionZ((prev) => prev + (data.dy * scaleFactor));
        }
      isProcessing.current = false; 
    };

    ws.current.onclose = () => console.log("WebSocket Closed!");
    return () => { if (ws.current) ws.current.close(); };
  }, []);

  useEffect(() => {
    let interval;
    if (isActive && hasPermission && device) {
      interval = setInterval(async () => {
        if (cameraRef.current && ws.current?.readyState === WebSocket.OPEN && !isProcessing.current) {
          isProcessing.current = true; 
          
          try {
            const photo = await cameraRef.current.takePhoto({
              flash: 'off',
              enableShutterSound: false,
              qualityPrioritization: 'speed', 
              quality: 10, 
              skipMetadata: true 
            });

            const response = await fetch(`file://${photo.path}`);
            const blob = await response.blob();

            ws.current.send(JSON.stringify({ 
              gyro_x: currentGyro.current.x, 
              gyro_y: currentGyro.current.y, 
              gyro_z: currentGyro.current.z 
            }));
            
            ws.current.send(blob);

          } catch (error) {
            console.log("Camera Error: ", error);
            isProcessing.current = false;
          }
        }
      }, 50); 
    }
    return () => clearInterval(interval);
  }, [isActive, hasPermission, device]);

  if (!hasPermission) return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00ffcc" /></View>;
  if (device == null) return <View style={styles.loadingContainer}><Text style={styles.loadingText}>No Camera Found!</Text></View>;

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        photo={true} 
      />

      {/* 🛠️ ALL TRACKING BOXES REMOVED FOR PURE VISIBILITY! */}

      <View style={styles.hudOverlay}>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: '#00ffcc' }]} />
          <Text style={styles.statusText}>
            X: {positionX.toFixed(2)}m | Z: {positionZ.toFixed(2)}m
          </Text>
        </View>

        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => {
            setIsActive(false);
            navigation.goBack();
          }}
        >
          <Text style={styles.backText}>Exit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loadingContainer: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#00ffcc', marginTop: 20, fontSize: 18, fontWeight: 'bold' },
  hudOverlay: { position: 'absolute', top: 50, width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, alignItems: 'flex-start' },
  statusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, borderWidth: 1, borderColor: '#00ffcc' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  statusText: { color: '#00ffcc', fontWeight: 'bold', fontSize: 14, fontFamily: 'monospace' },
  backButton: { backgroundColor: '#ff3333', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20 },
  backText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
});