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
document.addEventListener('click', () => controls.lock());

const keyStates = {};
let isTouching = false; // For mobile forward movement

document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

// --- 3. MOBILE TOUCH LOGIC ---
// Tap and hold to move forward
renderer.domElement.addEventListener('touchstart', (e) => {
    isTouching = true;
    // If not locked (on mobile), we manually trigger rotation via touch in the loop
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => {
    isTouching = false;
}, { passive: false });

// For mobile rotation (swiping)
let touchX, touchY;
renderer.domElement.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
        const t = e.touches[0];
        if (touchX !== undefined && touchY !== undefined) {
            const dx = t.pageX - touchX;
            const dy = t.pageY - touchY;
            
            // Manually rotate camera based on swipe
            camera.rotation.y -= dx * 0.005;
            camera.rotation.x -= dy * 0.005;
            camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
            camera.rotation.z = 0; // Maintain horizon lock
        }
        touchX = t.pageX;
        touchY = t.pageY;
    }
}, { passive: false });

// --- 4. MODEL LOADING ---
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

    // Speed halved to 0.04 for a smooth cinematic walk
    const speed = 0.04;

    if (controls.isLocked || isTouching) {
        // Keyboard movement
        if (keyStates['KeyW']) controls.moveForward(speed);
        if (keyStates['KeyS']) controls.moveForward(-speed);
        if (keyStates['KeyA']) controls.moveRight(-speed);
        if (keyStates['KeyD']) controls.moveRight(speed);
        
        // Manual Height
        if (keyStates['KeyE']) camera.position.y += speed;
        if (keyStates['KeyQ']) camera.position.y -= speed;

        // Mobile Forward: move in the direction the camera is facing
        if (isTouching && !controls.isLocked) {
            controls.moveForward(speed);
        }
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});