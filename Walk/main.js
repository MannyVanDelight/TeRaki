import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

// High-end Gradient Background (Grey to Dark Grey)
const canvas = document.createElement('canvas');
canvas.width = 2; canvas.height = 512;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#e0e0e0'); 
gradient.addColorStop(1, '#444444'); 
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(canvas);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // Adjust this if the scene is too dark/bright

// IMPORTANT FOR BAKED TEXTURES:
// sRGB ensures the colors you see in Blender match the browser.
renderer.outputColorSpace = THREE.SRGBColorSpace; 
document.body.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

// --- 2. STATE & HOME LOGIC ---
let yaw = Math.PI, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 1.4, 8), yaw: Math.PI };
let clippingBox = new THREE.Box3(), hasClipping = false;

function goHome() {
    camera.position.copy(homeData.pos);
    yaw = homeData.yaw; pitch = 0;
}

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// --- 3. INPUT HANDLING ---
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

document.addEventListener('click', () => { 
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) document.body.requestPointerLock();
});
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

renderer.domElement.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    lastTouchX = t.pageX; lastTouchY = t.pageY;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (touchMode === 'LOOK') {
        const t = e.touches[0];
        yaw -= (t.pageX - lastTouchX) * 0.005;
        pitch -= (t.pageY - lastTouchY) * 0.005;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
        lastTouchX = t.pageX; lastTouchY = t.pageY;
    }
}, { passive: false });

renderer.domElement.addEventListener('touchend', () => { touchMode = null; }, { passive: false });

// --- 4. MODEL LOADING (HYBRID BAKED + PBR) ---
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const rgbeLoader = new RGBELoader();
rgbeLoader.load('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture; 
});

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        // Helpers... (Start/Clip logic remains same)
        if (isMain) {
            if (name.includes("start")) {
                homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
                const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y + Math.PI;
                child.visible = false;
                return;
            }
            if (name.includes("clip")) {
                child.geometry.computeBoundingBox();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                child.visible = false; hasClipping = true;
                return;
            }
        }

        if (child.isMesh) {
            // THE HYBRID FIX:
            // We use your bake as the "Base Color" but keep it a Standard Material
            // so it can still receive reflections from the HDR.
            if (child.material.map) {
                // If you baked lighting, we don't want Three.js to add NEW shadows,
                // we just want it to show your bake and add reflections.
                child.material.envMapIntensity = 0.5; // Subtle reflections
                child.material.roughness = 0.2;       // Makes it "glossy"
                child.material.metalness = 0.5;       // Makes it "reflective"
            }
        }
    });
    scene.add(gltf.scene);
    if (isMain) goHome();
}

// --- 5. ANIMATION & MOVEMENT ---
function updateCameraRotation() {
    const target = new THREE.Vector3();
    const fX = Math.sin(yaw) * Math.cos(pitch), fY = Math.sin(pitch), fZ = Math.cos(yaw) * Math.cos(pitch);
    target.set(camera.position.x + fX, camera.position.y + fY, camera.position.z + fZ);
    camera.lookAt(target);
}

function animate() {
    requestAnimationFrame(animate);
    const speed = 0.05;
    let moveF = 0, moveS = 0;

    if (keyStates['KeyW'] || touchMode === 'WALK') moveF += 1;
    if (keyStates['KeyS']) moveF -= 1;
    if (keyStates['KeyA']) moveS -= 1;
    if (keyStates['KeyD']) moveS += 1;

    if (moveF !== 0 || moveS !== 0) {
        const fX = Math.sin(yaw), fZ = Math.cos(yaw);
        const rX = Math.sin(yaw - Math.PI / 2), rZ = Math.cos(yaw - Math.PI / 2);
        const nX = camera.position.x + (fX * moveF + rX * moveS) * speed;
        const nZ = camera.position.z + (fZ * moveF + rZ * moveS) * speed;
        if (!hasClipping || clippingBox.containsPoint(new THREE.Vector3(nX, camera.position.y, nZ))) {
            camera.position.x = nX; camera.position.z = nZ;
        }
    }
    updateCameraRotation();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});