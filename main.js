import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();

// --- 2. PLAYER & HEIGHT STATE ---
const worldOctree = new Octree();
const playerCollider = new Capsule(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.0, 0), 0.15);
const playerVelocity = new THREE.Vector3();

// We will use this variable to manually control your eye level
let eyeLevelOffset = 1.4; 

// --- 3. LOOK LOGIC (HORIZON LOCK) ---
let yaw = 0;   // Left/Right
let pitch = 0; // Up/Down

document.addEventListener('mousedown', () => { 
    if (document.pointerLockElement !== document.body) document.body.requestPointerLock(); 
});

document.body.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        yaw -= event.movementX * 0.002;
        pitch -= event.movementY * 0.002;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
        
        // Update camera rotation using Quaternions to prevent ANY Z-roll
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
        camera.quaternion.multiplyQuaternions(qYaw, qPitch);
    }
});

// --- 4. MOVEMENT & HEIGHT CONTROLS ---
const keyStates = {};
document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });

function handleControls(deltaTime) {
    const speed = 10;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    // WASD Movement
    if (keyStates['KeyW']) playerVelocity.add(forward.multiplyScalar(speed * deltaTime));
    if (keyStates['KeyS']) playerVelocity.add(forward.multiplyScalar(-speed * deltaTime));
    if (keyStates['KeyA']) playerVelocity.add(side.multiplyScalar(-speed * deltaTime));
    if (keyStates['KeyD']) playerVelocity.add(side.multiplyScalar(speed * deltaTime));

    // Q/E HEIGHT OVERRIDE
    if (keyStates['KeyQ']) eyeLevelOffset -= 2.0 * deltaTime; // Go Down
    if (keyStates['KeyE']) eyeLevelOffset += 2.0 * deltaTime; // Go Up
}

function updatePlayer(deltaTime) {
    let damping = Math.exp(-4 * deltaTime) - 1;
    playerVelocity.addScaledVector(playerVelocity, damping);

    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    playerCollider.translate(deltaPosition);

    const result = worldOctree.capsuleIntersect(playerCollider);
    if (result) {
        playerCollider.translate(result.normal.multiplyScalar(result.depth));
    }

    // APPLY HEIGHT: Take the feet and add our manual offset
    camera.position.copy(playerCollider.start);
    camera.position.y += eyeLevelOffset;
}

// --- 5. LOAD MODEL ---
const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
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
    worldOctree.fromGraphNode(gltf.scene); 
    playerCollider.translate(new THREE.Vector3(-2, 0, 5));
});

function animate() {
    const deltaTime = Math.min(0.05, clock.getDelta());
    handleControls(deltaTime);
    updatePlayer(deltaTime);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});