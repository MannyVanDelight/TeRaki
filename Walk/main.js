import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();

// CACHE CHECK: NEW GRADIENT (Sunset Gold to Dark Orange)
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#ffcc33'); // Gold Top
gradient.addColorStop(1, '#662200'); // Dark Brown/Orange Bottom
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

// WIDER FOV: Changed from 60 to 80 to make the house feel much bigger
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
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

// --- 3. MOBILE: INDEPENDENT ROTATION & MOVEMENT ---
let touchX, touchY;

renderer.domElement.addEventListener('touchstart', (e) => {
    isTouching = true;
    touchX = e.touches[0].pageX;
    touchY = e.touches[0].pageY;
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    const dx = t.pageX - touchX;
    const dy = t.pageY - touchY;

    // SENSITIVITY: Increased for easier U-turns
    const sensitivity = 0.008;

    camera.rotation.y -= dx * sensitivity;
    camera.rotation.x -= dy * sensitivity;
    camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
    camera.rotation.z = 0; 

    touchX = t.pageX;
    touchY = t.pageY;
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => {
    isTouching = false;
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

    const speed = 0.04; // Premium slow walking speed

    if (controls.isLocked) {
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        if (keyStates['KeyE']) camera.position.y += speed;
        if (keyStates['KeyQ']) camera.position.y -= speed;
    }

    // Mobile movement
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