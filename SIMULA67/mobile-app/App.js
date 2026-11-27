import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as ImagePicker from 'expo-image-picker';
import SlamScreen from './SlamScreen';

// ⚠️ KEEP YOUR LAPTOP'S IP ADDRESS HERE
const SERVER_URL = "http://192.168.100.184:8000/process-blueprint/";

// --- ARCHITECTURAL STANDARDS ---
const WALL_THICKNESS = 0.15; 
const COLUMN_THICKNESS = 0.3; 
const FLOOR_THICKNESS = 0.1; 
const ROOM_HEIGHT = 2.5; 
const TOTAL_FLOOR_HEIGHT = ROOM_HEIGHT + FLOOR_THICKNESS; 
const DOOR_HEIGHT = 2.1; 
const DOOR_WIDTH = 1.0; 
const WINDOW_WIDTH = 1.2;
const WINDOW_SILL_HEIGHT = 0.9;
const WINDOW_TOP_HEIGHT = 2.1;  

// --- CAMERA BRIDGE ---
function CameraUpdater({ fov }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [fov, camera]);
  return null;
}

// --- 3D COMPONENTS ---
function Wall({ start, end, height, floorIndex, isEditable, viewMode, onInteract }) {
  const [x1, z1] = start;
  const [x2, z2] = end;
  const centerX = (x1 + x2) / 2;
  const centerZ = (z1 + z2) / 2;
  const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));
  const angle = Math.atan2(x1 - x2, z1 - z2);
  const yOffset = floorIndex * TOTAL_FLOOR_HEIGHT;

  const opacity = viewMode === 'FULL' ? 1 : (isEditable ? 1 : 0.4);
  const color = viewMode === 'FULL' ? "#00ffcc" : (isEditable ? "#00ffcc" : "#00aa88");

  return (
    <mesh 
      position={[centerX, (height / 2) + yOffset, centerZ]} 
      rotation={[0, angle + Math.PI / 2, 0]}
      onClick={(e) => {
        if (viewMode === 'FULL' || !isEditable) return; 
        e.stopPropagation(); 
        if (onInteract) onInteract(e.point); 
      }}
    >
      <boxGeometry args={[length, height, WALL_THICKNESS]} />
      <meshStandardMaterial color={color} opacity={opacity} transparent={opacity < 1} />
    </mesh>
  );
}

function WallBlock({ start, end, bottomY, topY, floorIndex, isEditable, viewMode }) {
  const [x1, z1] = start;
  const [x2, z2] = end;
  const centerX = (x1 + x2) / 2;
  const centerZ = (z1 + z2) / 2;
  const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));
  const angle = Math.atan2(x1 - x2, z1 - z2);
  const blockHeight = topY - bottomY;
  const yOffset = floorIndex * TOTAL_FLOOR_HEIGHT;
  const yPosition = bottomY + (blockHeight / 2) + yOffset;

  const opacity = viewMode === 'FULL' ? 1 : (isEditable ? 1 : 0.4);
  const color = viewMode === 'FULL' ? "#00ffcc" : (isEditable ? "#00ffcc" : "#00aa88");

  return (
    <mesh position={[centerX, yPosition, centerZ]} rotation={[0, angle + Math.PI / 2, 0]}>
      <boxGeometry args={[length, blockHeight, WALL_THICKNESS]} />
      <meshStandardMaterial color={color} opacity={opacity} transparent={opacity < 1} />
    </mesh>
  );
}

function Column({ x, z, height, floorIndex, isEditable, viewMode }) {
  const yOffset = floorIndex * TOTAL_FLOOR_HEIGHT;
  const opacity = viewMode === 'FULL' ? 1 : (isEditable ? 1 : 0.4);
  const color = viewMode === 'FULL' ? "#ff3333" : (isEditable ? "#ff3333" : "#aa2222");

  return (
    <mesh position={[x, (height / 2) + yOffset, z]}>
      <boxGeometry args={[COLUMN_THICKNESS, height + 0.05, COLUMN_THICKNESS]} />
      <meshStandardMaterial color={color} opacity={opacity} transparent={opacity < 1} />
    </mesh>
  );
}

function Staircase({ x, z, floorIndex, isEditable, viewMode }) {
  const STEP_COUNT = 14; 
  const STEP_HEIGHT = TOTAL_FLOOR_HEIGHT / STEP_COUNT; 
  const STEP_DEPTH = 0.25; 
  const yOffset = floorIndex * TOTAL_FLOOR_HEIGHT;

  const opacity = viewMode === 'FULL' ? 1 : (isEditable ? 1 : 0.4);
  const color = viewMode === 'FULL' ? "#cccccc" : (isEditable ? "#cccccc" : "#666666");

  return (
    <group position={[x, yOffset, z]}>
      {Array.from({ length: STEP_COUNT }).map((_, i) => (
        <mesh key={i} position={[0, (i * STEP_HEIGHT) + (STEP_HEIGHT / 2), i * STEP_DEPTH]}>
          <boxGeometry args={[1.0, STEP_HEIGHT, STEP_DEPTH]} />
          <meshStandardMaterial color={color} opacity={opacity} transparent={opacity < 1} />
        </mesh>
      ))}
    </group>
  );
}

// --- 1. THE MAIN MENU SCREEN ---
function HomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>SIMULA67</Text>
      
      {/* Existing 2D-to-3D Button */}
      <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Simulate')}>
        <Text style={styles.buttonText}>Simulate (2D to 3D)</Text>
      </TouchableOpacity>

      {/* --- NEW: THE SLAM BUTTON --- */}
      <TouchableOpacity style={[styles.button, { borderColor: '#ff3333' }]} onPress={() => navigation.navigate('Slam')}>
        <Text style={styles.buttonText}>Mini-SLAM Tracking</Text>
      </TouchableOpacity>
      
    </View>
  );
}

// --- 2. THE SIMULATION SCREEN ---
function SimulateScreen() {
  const [imageUri, setImageUri] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // -- NEW: We added offsetX and offsetZ to the state! --
  const [floorsData, setFloorsData] = useState([
    { walls: [], blocks: [], stairs: [], isVisible: true, style: 'FOUNDATION', offsetX: 0, offsetZ: 0 }
  ]);
  const [activeFloor, setActiveFloor] = useState(0); 

  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [viewMode, setViewMode] = useState('EDIT'); 
  const [activeTool, setActiveTool] = useState('DOOR'); 
  
  const [cameraFov, setCameraFov] = useState(50);
  const [canvasKey, setCanvasKey] = useState(0);

  const handleZoomIn = () => setCameraFov(prev => Math.max(20, prev - 10));
  const handleZoomOut = () => setCameraFov(prev => Math.min(90, prev + 10));
  const handleReset = () => { setCameraFov(50); setCanvasKey(prev => prev + 1); };

  const saveToHistory = (newFloorsData) => {
    const newRecord = JSON.parse(JSON.stringify(newFloorsData));
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newRecord);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setFloorsData(newFloorsData);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setFloorsData(history[historyIndex - 1]);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setFloorsData(history[historyIndex + 1]);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const toggleVisibility = (index) => {
    const newFloors = JSON.parse(JSON.stringify(floorsData));
    newFloors[index].isVisible = !newFloors[index].isVisible;
    setFloorsData(newFloors); 
  };

  const toggleFloorStyle = () => {
    if (activeFloor === 0) return; 
    const newFloors = JSON.parse(JSON.stringify(floorsData));
    newFloors[activeFloor].style = newFloors[activeFloor].style === 'EXACT' ? 'TERRACE' : 'EXACT';
    saveToHistory(newFloors);
  };

  const addNewFloor = () => {
    const newFloors = [...floorsData, { walls: [], blocks: [], stairs: [], isVisible: true, style: 'EXACT', offsetX: 0, offsetZ: 0 }];
    setActiveFloor(newFloors.length - 1);
    saveToHistory(newFloors);
  };

  // --- NEW: THE NUDGE FUNCTION ---
  // Moves the active floor by 0.2 meters per tap
  const nudgeFloor = (dx, dz) => {
    const newFloors = JSON.parse(JSON.stringify(floorsData));
    newFloors[activeFloor].offsetX += dx;
    newFloors[activeFloor].offsetZ += dz;
    setFloorsData(newFloors); // We don't save every tiny nudge to history to avoid flooding the undo button
  };

  const handleWallInteract = (wallIndex, clickPoint) => {
    if (viewMode === 'FULL' || activeTool === 'STAIRS') return; 

    const currentFloorData = floorsData[activeFloor];
    const wall = currentFloorData.walls[wallIndex];
    const [x1, z1] = wall.start;
    const [x2, z2] = wall.end;
    
    // --- UPDATED MATH: Subtract the floor offset so the punch registers perfectly! ---
    const cx = clickPoint.x - (currentFloorData.offsetX || 0);
    const cz = clickPoint.z - (currentFloorData.offsetZ || 0);

    const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));
    const punchWidth = activeTool === 'DOOR' ? DOOR_WIDTH : WINDOW_WIDTH;

    if (length <= punchWidth + 0.2) return Alert.alert("Too Small", `This wall is too short!`);

    let safeDist = Math.sqrt(Math.pow(cx - x1, 2) + Math.pow(cz - z1, 2));
    if (safeDist < punchWidth / 2) safeDist = punchWidth / 2;
    if (safeDist > length - punchWidth / 2) safeDist = length - punchWidth / 2;

    const ratioStart = (safeDist - punchWidth / 2) / length;
    const ratioEnd = (safeDist + punchWidth / 2) / length;

    const holeStartX = x1 + (x2 - x1) * ratioStart;
    const holeStartZ = z1 + (z2 - z1) * ratioStart;
    const holeEndX = x1 + (x2 - x1) * ratioEnd;
    const holeEndZ = z1 + (z2 - z1) * ratioEnd;

    const newFloors = JSON.parse(JSON.stringify(floorsData));
    newFloors[activeFloor].walls.splice(wallIndex, 1);
    newFloors[activeFloor].walls.push({ start: [x1, z1], end: [holeStartX, holeStartZ] });
    newFloors[activeFloor].walls.push({ start: [holeEndX, holeEndZ], end: [x2, z2] });

    if (activeTool === 'DOOR') {
      newFloors[activeFloor].blocks.push({ start: [holeStartX, holeStartZ], end: [holeEndX, holeEndZ], bottomY: DOOR_HEIGHT, topY: ROOM_HEIGHT });
    } else if (activeTool === 'WINDOW') {
      newFloors[activeFloor].blocks.push({ start: [holeStartX, holeStartZ], end: [holeEndX, holeEndZ], bottomY: WINDOW_TOP_HEIGHT, topY: ROOM_HEIGHT }); 
      newFloors[activeFloor].blocks.push({ start: [holeStartX, holeStartZ], end: [holeEndX, holeEndZ], bottomY: 0, topY: WINDOW_SILL_HEIGHT }); 
    }

    saveToHistory(newFloors);
  };

  const handleFloorInteract = (clickPoint) => {
    if (viewMode === 'FULL' || activeTool !== 'STAIRS') return;
    const currentFloorData = floorsData[activeFloor];
    // Subtract offset for stairs placement too!
    const cx = clickPoint.x - (currentFloorData.offsetX || 0);
    const cz = clickPoint.z - (currentFloorData.offsetZ || 0);

    const newFloors = JSON.parse(JSON.stringify(floorsData));
    newFloors[activeFloor].stairs.push({ x: cx, z: cz });
    saveToHistory(newFloors);
  };

  const buildingMetrics = useMemo(() => {
    return floorsData.map((floorData, index) => {
      if (floorData.walls.length === 0) return { columns: [], slab: null };
      
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const cornerMap = {};

      floorData.walls.forEach(wall => {
        minX = Math.min(minX, wall.start[0], wall.end[0]);
        maxX = Math.max(maxX, wall.start[0], wall.end[0]);
        minZ = Math.min(minZ, wall.start[1], wall.end[1]);
        maxZ = Math.max(maxZ, wall.start[1], wall.end[1]);

        const startKey = `${wall.start[0].toFixed(1)},${wall.start[1].toFixed(1)}`;
        const endKey = `${wall.end[0].toFixed(1)},${wall.end[1].toFixed(1)}`;
        if (!cornerMap[startKey]) cornerMap[startKey] = { x: wall.start[0], z: wall.start[1], count: 0 };
        if (!cornerMap[endKey]) cornerMap[endKey] = { x: wall.end[0], z: wall.end[1], count: 0 };
        cornerMap[startKey].count++;
        cornerMap[endKey].count++;
      });

      const columns = Object.values(cornerMap).filter(c => c.count >= 2);
      
      let padding = 0;
      if (index === 0) padding = 1.5; 
      else if (floorData.style === 'TERRACE') padding = 1.5;

      const slab = { width: (maxX - minX) + padding, depth: (maxZ - minZ) + padding, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
      return { columns, slab };
    });
  }, [floorsData]);

  const pickImageAndSend = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 });
    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
      sendToServer(result.assets[0].uri);
    }
  };

  const sendToServer = async (uri) => {
    setIsLoading(true);
    let formData = new FormData();
    formData.append('file', { uri: uri, name: 'blueprint.jpg', type: 'image/jpeg' });

    try {
      let response = await fetch(SERVER_URL, { method: 'POST', body: formData, headers: { 'Content-Type': 'multipart/form-data' } });
      let jsonMath = await response.json();
      if(jsonMath.status === "success") {
        const newFloors = JSON.parse(JSON.stringify(floorsData));
        newFloors[activeFloor].walls = jsonMath.walls; 
        newFloors[activeFloor].blocks = [];
        // Reset offsets when a new blueprint is loaded
        newFloors[activeFloor].offsetX = 0;
        newFloors[activeFloor].offsetZ = 0;
        saveToHistory(newFloors);
      }
    } catch (error) {
      Alert.alert("Server Error", "Make sure the Python server is running!");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#1e1e1e' }}>
      
      <View style={styles.controlBar}>
        {viewMode === 'EDIT' ? (
          <>
            <TouchableOpacity style={styles.uploadButton} onPress={pickImageAndSend}>
              <Text style={styles.buttonText}>Upload</Text>
            </TouchableOpacity>
            
            {activeFloor > 0 && floorsData[activeFloor].walls.length > 0 && (
              <TouchableOpacity style={styles.toggleButton} onPress={toggleFloorStyle}>
                <Text style={styles.buttonText}>{floorsData[activeFloor].style}</Text>
              </TouchableOpacity>
            )}

            <View style={styles.historyControls}>
              <TouchableOpacity style={[styles.historyBtn, historyIndex <= 0 && styles.disabledBtn]} onPress={undo} disabled={historyIndex <= 0}><Text style={styles.iconText}>↩</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.historyBtn, historyIndex >= history.length - 1 && styles.disabledBtn]} onPress={redo} disabled={historyIndex >= history.length - 1}><Text style={styles.iconText}>↪</Text></TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={{color: '#00ffcc', fontWeight: 'bold', fontSize: 20}}>👁️ FULL RENDER</Text>
        )}

        <TouchableOpacity 
          style={{ backgroundColor: viewMode === 'FULL' ? '#00ffcc' : '#333', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#00ffcc' }}
          onPress={() => setViewMode(prev => prev === 'EDIT' ? 'FULL' : 'EDIT')}
        >
          <Text style={{ color: viewMode === 'FULL' ? '#000' : '#fff', fontWeight: 'bold' }}>
            {viewMode === 'EDIT' ? 'VIEW' : 'EDIT'}
          </Text>
        </TouchableOpacity>

        {isLoading && <ActivityIndicator size="small" color="#00ffcc" />}
      </View>

      {viewMode === 'EDIT' && (
        <View style={styles.storySelector}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, alignItems: 'center', paddingHorizontal: 20 }}>
            <Text style={{ color: 'white', fontWeight: 'bold' }}>FLOORS: </Text>
            {floorsData.map((floor, i) => (
              <View key={i} style={styles.floorGroup}>
                <TouchableOpacity style={[styles.storyBtn, activeFloor === i && styles.activeStoryBtn]} onPress={() => setActiveFloor(i)}>
                  <Text style={styles.storyText}>{i + 1}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.eyeBtn} onPress={() => toggleVisibility(i)}>
                  <Text style={{ fontSize: 16 }}>{floor.isVisible ? '👁️' : '🙈'}</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addStoryBtn} onPress={addNewFloor}>
              <Text style={styles.storyText}>+ Add Level</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <View style={{ flex: 1 }}>
        <Canvas key={canvasKey} camera={{ position: [0, 20 + (activeFloor * 3), 20] }}>
          <CameraUpdater fov={cameraFov} /> 
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
            <planeGeometry args={[200, 200]} />
            <meshStandardMaterial color="#111111" />
          </mesh>

          {floorsData.map((floorData, floorIndex) => {
            if (viewMode === 'EDIT' && !floorData.isVisible) return null;

            const metrics = buildingMetrics[floorIndex];
            const isEditable = floorIndex === activeFloor; 

            return (
              // --- MAGIC HERE: The entire floor group moves based on offset! ---
              <group key={`floor-${floorIndex}`} position={[floorData.offsetX || 0, 0, floorData.offsetZ || 0]}>
                
                {metrics.slab && (
                  <mesh 
                    position={[metrics.slab.centerX, -0.05 + (floorIndex * TOTAL_FLOOR_HEIGHT), metrics.slab.centerZ]}
                    onClick={(e) => {
                      if (viewMode === 'FULL' || !isEditable) return; 
                      e.stopPropagation();
                      handleFloorInteract(e.point);
                    }}
                  >
                    <boxGeometry args={[metrics.slab.width, FLOOR_THICKNESS, metrics.slab.depth]} />
                    <meshStandardMaterial color={viewMode === 'FULL' ? "#888888" : (isEditable ? "#888888" : "#444444")} opacity={viewMode === 'FULL' ? 1 : (isEditable ? 1 : 0.4)} transparent={viewMode === 'EDIT' && !isEditable} />
                  </mesh>
                )}

                {floorData.walls.map((wall, i) => <Wall key={`w-${i}`} start={wall.start} end={wall.end} height={ROOM_HEIGHT} floorIndex={floorIndex} isEditable={isEditable} viewMode={viewMode} onInteract={(point) => handleWallInteract(i, point)} />)}
                {floorData.blocks.map((block, i) => <WallBlock key={`b-${i}`} start={block.start} end={block.end} bottomY={block.bottomY} topY={block.topY} floorIndex={floorIndex} isEditable={isEditable} viewMode={viewMode} />)}
                {metrics.columns.map((col, i) => <Column key={`c-${i}`} x={col.x} z={col.z} height={ROOM_HEIGHT} floorIndex={floorIndex} isEditable={isEditable} viewMode={viewMode} />)}
                {floorData.stairs.map((stair, i) => <Staircase key={`s-${i}`} x={stair.x} z={stair.z} floorIndex={floorIndex} isEditable={isEditable} viewMode={viewMode} />)}
              </group>
            );
          })}

          <OrbitControls makeDefault={true} rotateSpeed={1.5} maxPolarAngle={Math.PI / 2 - 0.05} minDistance={5} maxDistance={80} enableDamping={true} dampingFactor={0.05} enableZoom={false} enablePan={false} />
        </Canvas>

        {/* --- NEW: THE D-PAD NUDGE TOOL --- */}
        {/* Only shows in Edit mode when editing Floor 2+ */}
        {viewMode === 'EDIT' && activeFloor > 0 && (
          <View style={styles.dPadContainer}>
            <Text style={{color: '#aaa', fontSize: 10, fontWeight: 'bold'}}>ALIGN FLOOR {activeFloor + 1}</Text>
            <TouchableOpacity style={styles.nudgeBtn} onPress={() => nudgeFloor(0, -0.2)}><Text style={styles.iconText}>⬆️</Text></TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.nudgeBtn} onPress={() => nudgeFloor(-0.2, 0)}><Text style={styles.iconText}>⬅️</Text></TouchableOpacity>
              <TouchableOpacity style={styles.nudgeBtn} onPress={() => nudgeFloor(0.2, 0)}><Text style={styles.iconText}>➡️</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.nudgeBtn} onPress={() => nudgeFloor(0, 0.2)}><Text style={styles.iconText}>⬇️</Text></TouchableOpacity>
          </View>
        )}

        {viewMode === 'EDIT' && floorsData[activeFloor].walls.length > 0 && (
          <View style={styles.toolBar}>
            <TouchableOpacity style={[styles.toolBtn, activeTool === 'DOOR' && styles.activeTool]} onPress={() => setActiveTool('DOOR')}><Text style={styles.toolText}>🚪</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, activeTool === 'WINDOW' && styles.activeTool]} onPress={() => setActiveTool('WINDOW')}><Text style={styles.toolText}>🪟</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, activeTool === 'STAIRS' && styles.activeTool]} onPress={() => setActiveTool('STAIRS')}><Text style={styles.toolText}>🪜</Text></TouchableOpacity>
          </View>
        )}

        <View style={styles.floatingUI}>
          <TouchableOpacity style={styles.circleButton} onPress={handleZoomIn}><Text style={styles.iconText}>+</Text></TouchableOpacity>
          <TouchableOpacity style={styles.circleButton} onPress={handleReset}><Text style={styles.iconText}>⟲</Text></TouchableOpacity>
          <TouchableOpacity style={styles.circleButton} onPress={handleZoomOut}><Text style={styles.iconText}>-</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// --- NAVIGATION SETUP ---
const Stack = createNativeStackNavigator();
export default function App() { 
  return ( 
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Simulate" component={SimulateScreen} />
        {/* ADD THIS NEW LINE */}
        <Stack.Screen name="Slam" component={SlamScreen} /> 
      </Stack.Navigator>
    </NavigationContainer> 
  ); 
}
// --- STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 40, fontWeight: 'bold', color: '#00ffcc', marginBottom: 50 },
  button: { backgroundColor: '#333', padding: 20, borderRadius: 10, width: '80%', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#00ffcc' },
  buttonText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
  controlBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 50, backgroundColor: '#121212', zIndex: 10 },
  uploadButton: { backgroundColor: '#00ffcc', padding: 10, borderRadius: 8 },
  toggleButton: { backgroundColor: '#555', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#00ffcc' },
  historyControls: { flexDirection: 'row', gap: 5 },
  historyBtn: { backgroundColor: '#333', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#00ffcc' },
  disabledBtn: { opacity: 0.3, borderColor: '#555' },
  storySelector: { backgroundColor: '#222', paddingVertical: 10, zIndex: 10, borderBottomWidth: 1, borderColor: '#444' },
  floorGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#333', borderRadius: 20, paddingRight: 5 },
  storyBtn: { paddingVertical: 5, paddingHorizontal: 15, borderRadius: 20 },
  activeStoryBtn: { backgroundColor: '#00ffcc' },
  eyeBtn: { padding: 5 },
  addStoryBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#00ffcc', paddingVertical: 5, paddingHorizontal: 15, borderRadius: 20 },
  storyText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  floatingUI: { position: 'absolute', right: 20, bottom: 40, backgroundColor: 'rgba(30, 30, 30, 0.8)', padding: 10, borderRadius: 30, alignItems: 'center', gap: 15 },
  circleButton: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#00ffcc' },
  iconText: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  toolBar: { position: 'absolute', top: 20, alignSelf: 'center', flexDirection: 'row', backgroundColor: 'rgba(30, 30, 30, 0.9)', padding: 5, borderRadius: 20, gap: 5 },
  toolBtn: { paddingVertical: 10, paddingHorizontal: 15, borderRadius: 15 },
  activeTool: { backgroundColor: '#00ffcc' },
  toolText: { color: 'white', fontWeight: 'bold', fontSize: 18 },
  dPadContainer: { position: 'absolute', left: 20, bottom: 40, alignItems: 'center', gap: 5 },
  nudgeBtn: { backgroundColor: 'rgba(51, 51, 51, 0.8)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#00ffcc' }
});