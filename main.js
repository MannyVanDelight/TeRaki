import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 1. Setup Scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 2. Add Lighting (Crucial or your model will be black)
scene.background = new THREE.Color(0x808080); // Makes the background grey
const ambientLight = new THREE.AmbientLight(0xffffff, 1); 
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(10, 10, 10);
scene.add(directionalLight);

// 3. Add Interaction (Pivot/Zoom)
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 5, 15);
controls.update();

// 4. Load the Model
const loader = new GLTFLoader();
loader.load('./models/TeRaki-05.glb', (gltf) => {
    scene.add(gltf.scene);

    // Find the camera named "Camera" (or whatever you named it in Blender)
    const blenderCamera = gltf.cameras[0]; 
    
    if (blenderCamera) {
        // Option 1: Just copy the position/rotation to your current camera
        camera.position.copy(blenderCamera.position);
        camera.quaternion.copy(blenderCamera.quaternion);
        
        // Option 2: Replace your camera with the Blender one entirely
        // activeCamera = blenderCamera; 
    }
    
    // Update controls to look at the new position
    controls.update();
});

    // Optional: Force it to a visible size if it's too small/big
    // model.scale.set(1, 1, 1); 
 undefined, (error) => {
    console.error("Loader error:", error);
});

// 5. Animation Loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

setInterval(() => {
    if (camera && controls) {
        console.log("Camera Pos:", camera.position.x, camera.position.y, camera.position.z);
        console.log("Target Pos:", controls.target.x, controls.target.y, controls.target.z);
    }
}, 2000); // <--- Make sure it has the parenthesis and semicolon here!