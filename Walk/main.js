import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Deep charcoal background

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Starting position: slightly back and at a "human" height
camera.position.set(0, 1.4, 5); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. THE CONTROLS (HORIZON LOCKED) ---
const controls = new PointerLockControls(camera, document.body);

// Click anywhere to lock the mouse and start the tour
document.addEventListener('click', () => {
    controls.lock();
});

const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 3. THE MODEL ---
const loader = new GLTFLoader();
loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            // Restore your baked lighting
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            
            // Transparency for windows/glass
            if (child.material.map) {
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
                child.material.side = THREE.DoubleSide;
            }
        }
    });
    scene.add(gltf.scene);
    console.log("Tour Active: Click to start. WASD to walk. Q/E to change height.");
});

// --- 4. ENGINE LOOP ---
function animate() {
    requestAnimationFrame(animate);

    if (controls.isLocked) {
        const speed = 0.08; // Walking speed
        
        // Standard WASD
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        
        // --- HEIGHT CONTROLS ---
        if (keyStates['KeyE']) camera.position.y += speed; // Go UP
        if (keyStates['KeyQ']) camera.position.y -= speed; // Go DOWN
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});