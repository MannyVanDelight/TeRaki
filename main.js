import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080); // This gives you the grey background

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- 2. LIGHTS ---
const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// --- 3. CONTROLS ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; 

// !!! UPDATE THESE NUMBERS WITH YOUR LOGS LATER !!!
camera.position.set(0, 2, 10); 
controls.update();

// --- 4. LOAD MODEL (The Simple Version) ---
const loader = new GLTFLoader();
loader.load(
    './models/TeRaki-05.glb',
    (gltf) => {
        scene.add(gltf.scene);
        console.log("Model Loaded!");
    },
    undefined,
    (error) => {
        console.error("An error happened:", error);
    }
);

// --- 5. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// --- 6. COORDINATE FINDER ---
// This is the safe way to get your numbers without crashing the script
setInterval(() => {
    // Only print if camera exists to prevent errors
    if (camera && controls) {
        console.log("--- COPY THESE ---");
        console.log("Camera:", camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
        console.log("Target:", controls.target.x.toFixed(2), controls.target.y.toFixed(2), controls.target.z.toFixed(2));
    }
}, 2000);

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});