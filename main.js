import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. BASIC SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xff0000); // Darker background to make the house pop

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Starting position: slightly back and at a 1.4m "human" height
camera.position.set(0, 1.4, 5); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. CONTROLS (THE FIX) ---
// PointerLockControls is mathematically incapable of "rolling" the horizon.
const controls = new PointerLockControls(camera, document.body);

// Click anywhere to start the tour
document.addEventListener('click', () => {
    controls.lock();
});

const keyStates = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false
};

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keyStates.forward = true;
    if (e.code === 'KeyS') keyStates.backward = true;
    if (e.code === 'KeyA') keyStates.left = true;
    if (e.code === 'KeyD') keyStates.right = true;
    if (e.code === 'KeyE') keyStates.up = true;   // E to fly UP
    if (e.code === 'KeyQ') keyStates.down = true; // Q to fly DOWN
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keyStates.forward = false;
    if (e.code === 'KeyS') keyStates.backward = false;
    if (e.code === 'KeyA') keyStates.left = false;
    if (e.code === 'KeyD') keyStates.right = false;
    if (e.code === 'KeyE') keyStates.up = false;
    if (e.code === 'KeyQ') keyStates.down = false;
});

// --- 3. LOAD THE MODEL ---
const loader = new GLTFLoader();
loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            // Apply your baked texture to the emissive slot so it's bright
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            
            // Transparency for windows
            if (child.material.map) {
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
            }
        }
    });
    scene.add(gltf.scene);
    console.log("Model loaded. Click screen to move. Q/E for height.");
});

// --- 4. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    if (controls.isLocked) {
        const moveSpeed = 0.1;
        
        if (keyStates.forward) controls.moveForward(moveSpeed);
        if (keyStates.backward) controls.moveForward(-moveSpeed);
        if (keyStates.left) controls.moveRight(-moveSpeed);
        if (keyStates.right) controls.moveRight(moveSpeed);
        
        // Manual Height Control (The specific fix you asked for)
        if (keyStates.up) camera.position.y += moveSpeed;
        if (keyStates.down) camera.position.y -= moveSpeed;
    }

    renderer.render(scene, camera);
}

animate();

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});