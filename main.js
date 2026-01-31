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
    const model = gltf.scene;
    scene.add(model);

    // This will tell us the exact size in the browser console (F12)
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    
    console.log("Model Size X:", size.x);
    console.log("Model Size Y:", size.y);
    console.log("Model Size Z:", size.z);

    // Optional: Force it to a visible size if it's too small/big
    // model.scale.set(1, 1, 1); 
}, undefined, (error) => {
    console.error("Loader error:", error);
});

// 5. Animation Loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();