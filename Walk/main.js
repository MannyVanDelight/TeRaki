import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();

// Gradient Background
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#e0e0e0'); 
gradient.addColorStop(1, '#444444'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.4, 8); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. CONTROLS STATE ---
const controls = new PointerLockControls(camera, document.body);
document.addEventListener('click', () => { if(!isMobile) controls.lock(); });

const keyStates = {};
let isTouching = false; 
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 3. MOBILE: SEPARATE TURN & MOVE ---
let touchX, touchY;

renderer.domElement.addEventListener('touchstart', (e) => {
    // If you tap with one finger and don't move it much, it's a "Move" command
    isTouching = true;
    touchX = e.touches[0].pageX;
    touchY = e.touches[0].pageY;
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    
    // Calculate Swipe Distance
    const dx = t.pageX - touchX;
    const dy = t.pageY - touchY;

    // SENSITIVITY: Higher value here makes U-turns easier
    const sensitivity = 0.007;

    // Rotate camera independently of movement
    camera.rotation.y -= dx * sensitivity;
    camera.rotation.x -= dy * sensitivity;
    
    // Lock horizon and clamp vertical look
    camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
    camera.rotation.z = 0; 

    // Update coordinates for next frame
    touchX = t.pageX;
    touchY = t.pageY;

    // If we are swiping significantly, stop walking so we can turn in place
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        // This allows "Stationary Turning"
    }
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => {
    isTouching = false;
    touchX = undefined;
    touchY = undefined;
}, { passive: false });

// --- 4. MODEL LOADING (DRACO) ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load('./models/TeRaki-05.glb', (gltf) => {
    gltf.scene.traverse((child) => {
        if (child.isMesh) {
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            if (child.material.map) {
                child.material.transparent = true;
                child.material.alphaTest = 0.5;
                child.material.side = THREE.DoubleSide;
            }
        }
    });
    scene.add(gltf.scene);
});

// --- 5. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    const speed = 0.04; // Half-speed as requested

    // KEYBOARD (Desktop)
    if (controls.isLocked) {
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        if (keyStates['KeyE']) camera.position.y += speed;
        if (keyStates['KeyQ']) camera.position.y -= speed;
    }

    // MOBILE MOVEMENT (Auto-Forward on Tap)
    // We only move forward if we aren't swiping wildly
    if (isTouching && isMobile) {
        controls.moveForward(speed);
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});