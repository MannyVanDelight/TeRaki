import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
// Changed to BLACK to prove the code is updating
scene.background = new THREE.Color(0x000000); 

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Start at a lower "Human" height
camera.position.set(0, 1.3, 5); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. THE CONTROLS ---
const controls = new PointerLockControls(camera, document.body);
document.addEventListener('click', () => controls.lock());

const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 3. THE MODEL ---
new GLTFLoader().load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveIntensity = 1.0;
        }
    });
    scene.add(gltf.scene);
});

// --- 4. ENGINE ---
function animate() {
    requestAnimationFrame(animate);
    if (controls.isLocked) {
        const speed = 0.1;
        // Horizontal Movement
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        
        // --- HEIGHT CONTROLS (Manual Override) ---
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