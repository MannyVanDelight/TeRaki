import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); 

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Start at human height, 8 meters back
camera.position.set(0, 1.5, 8); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. CONTROLS ---
const controls = new PointerLockControls(camera, document.body);
document.addEventListener('click', () => controls.lock());

const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 3. DRACO & MODEL LOADING ---
const dracoLoader = new DRACOLoader();
// This link points to the official Google decoder files so it works anywhere
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader); // This fixes the error you saw!

loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            // Restore baked lighting
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            
            // Restore transparency
            if (child.material.map) {
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
                child.material.side = THREE.DoubleSide;
            }
        }
    });
    scene.add(gltf.scene);
    console.log("Draco model loaded and emissive materials applied!");
}, 
// Progress log
(xhr) => { console.log((xhr.loaded / xhr.total * 100) + '% loaded'); },
// Error log
(err) => { console.error("Loading error:", err); });

// --- 4. ENGINE LOOP ---
function animate() {
    requestAnimationFrame(animate);

    if (controls.isLocked) {
        const speed = 0.1;
        
        // Horizontal
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        
        // Manual Height Override (Q/E)
        if (keyStates['KeyE']) camera.position.y += speed;
        if (keyStates['KeyQ']) camera.position.y -= speed;
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});