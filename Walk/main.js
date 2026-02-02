import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // Black background

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// STARTING POSITION: Let's set this to a point where you can see the house
camera.position.set(0, 1.5, 8); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. CONTROLS (Stable Horizon & Q/E Height) ---
const controls = new PointerLockControls(camera, document.body);
document.addEventListener('click', () => controls.lock());

const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 3. THE MODEL (Restored Emissive/Transparency) ---
const loader = new GLTFLoader();
loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            // Your working baked light setup
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            
            // Transparency and Windows
            if (child.material.map) {
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
                child.material.side = THREE.DoubleSide;
            }
        }
    });
    scene.add(gltf.scene);
    console.log("Model loaded successfully.");
});

// --- 4. ENGINE LOOP ---
function animate() {
    requestAnimationFrame(animate);

    if (controls.isLocked) {
        const speed = 0.1;
        
        // WASD Movement
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        
        // Q/E HEIGHT OVERRIDE
        if (keyStates['KeyE']) camera.position.y += speed; // Go UP
        if (keyStates['KeyQ']) camera.position.y -= speed; // Go DOWN
    }

    renderer.render(scene, camera);
}
animate();

// Resize handling
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});