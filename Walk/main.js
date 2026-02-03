import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();

// Sunset Gradient
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#ffcc33'); 
gradient.addColorStop(1, '#662200'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.4, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. THE STABLE ROTATION ENGINE ---
let yaw = 0;   // Horizontal
let pitch = 0; // Vertical
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// This function forces the camera to look at a target, keeping the horizon level
function updateCameraRotation() {
    const target = new THREE.Vector3();
    const phi = THREE.MathUtils.degToRad(90 - pitch);
    const theta = THREE.MathUtils.degToRad(yaw);
    target.setFromSphericalCoords(1, phi, theta).add(camera.position);
    camera.lookAt(target);
}

// --- 3. CONTROLS STATE ---
const controls = new PointerLockControls(camera, document.body);
const keyStates = {};
let isWalking = false;
let touchStartX, touchStartY;

// Desktop Click
document.addEventListener('click', () => { if(!isMobile) controls.lock(); });
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 4. MOBILE SPLIT-SCREEN LOGIC ---
renderer.domElement.addEventListener('touchstart', (e) => {
    e.preventDefault(); // STOPS BROWSER ZOOMING
    const t = e.touches[0];
    touchStartX = t.pageX;
    touchStartY = t.pageY;

    // Split Screen: Left 50% walks, Right 50% looks
    if (t.pageX < window.innerWidth / 2) {
        isWalking = true;
    }
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    e.preventDefault(); // STOPS BROWSER ZOOMING
    const t = e.touches[0];
    
    // Only the RIGHT side controls the camera
    if (t.pageX > window.innerWidth / 2) {
        const dx = t.pageX - touchStartX;
        const dy = t.pageY - touchStartY;

        yaw -= dx * 0.2; // Sensitivity
        pitch += dy * 0.2;
        pitch = Math.max(-85, Math.min(85, pitch)); // Prevent flipping

        touchStartX = t.pageX;
        touchStartY = t.pageY;
    }
}, { passive: false });

renderer.domElement.addEventListener('touchend', (e) => {
    isWalking = false;
}, { passive: false });

// --- 5. MODEL LOADING ---
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

// --- 6. ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    const speed = 0.04;

    // Desktop Movement
    if (controls.isLocked) {
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        if (keyStates['KeyE']) camera.position.y += speed;
        if (keyStates['KeyQ']) camera.position.y -= speed;
        // Sync desktop look to our system
        yaw -= controls.getObject().rotation.y * 0.01; // placeholder logic
    }

    // Mobile Walk
    if (isWalking && isMobile) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        dir.y = 0; // Keep on ground
        dir.normalize();
        camera.position.addScaledVector(dir, speed);
    }

    // ALWAYS force rotation to be horizon-locked
    if (isMobile) {
        updateCameraRotation();
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});