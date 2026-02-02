import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Octree } from 'three/examples/jsm/math/Octree.js';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';

// --- 1. SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x808080);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

// NEW: Store rotation in a dedicated object to prevent the "Roll" fight
const playerRotation = new THREE.Euler(0, 0, 0, 'YXZ');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();

// --- 2. PHYSICS & PLAYER ---
const worldOctree = new Octree();

// FORCE EYE LEVEL: We will manually offset the camera from the feet
const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1.35, 0), 0.35);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();

// Spawn point
const spawnPoint = new THREE.Vector3(-2, 0, 5); 

// --- 3. CONTROLS ---
const keyStates = {};
let isMovingMobile = false;

document.addEventListener('keydown', (e) => { keyStates[e.code] = true; });
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });
window.addEventListener('touchstart', () => { isMovingMobile = true; });
window.addEventListener('touchend', () => { isMovingMobile = false; });

document.addEventListener('mousedown', () => { document.body.requestPointerLock(); });

document.body.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === document.body) {
        // We update our CUSTOM rotation object, NOT the camera directly yet
        playerRotation.y -= event.movementX * 0.002;
        playerRotation.x -= event.movementY * 0.002;

        // Clamp vertical look
        playerRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, playerRotation.x));
        
        // STRIKE THE ROLL: We never touch playerRotation.z, so it stays 0
    }
});

// --- 4. MOVEMENT ---
function handleControls(deltaTime) {
    const speed = 10;
    
    // Calculate direction based on our stable playerRotation
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, playerRotation.y, 0));
    const side = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, playerRotation.y, 0));

    if (keyStates['KeyW'] || isMovingMobile) playerVelocity.add(forward.multiplyScalar(speed * deltaTime));
    if (keyStates['KeyS']) playerVelocity.add(forward.multiplyScalar(-speed * deltaTime));
    if (keyStates['KeyA']) playerVelocity.add(side.multiplyScalar(-speed * deltaTime));
    if (keyStates['KeyD']) playerVelocity.add(side.multiplyScalar(speed * deltaTime));
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

    // --- FORCING CAMERA HEIGHT ---
    // We take the feet position (start) and add exactly 1.5m to it
    camera.position.copy(playerCollider.start);
    camera.position.y += 1.5; // Change this number to go higher/lower instantly

    // --- FORCING HORIZON LOCK ---
    camera.quaternion.setFromEuler(playerRotation);
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
    playerCollider.translate(spawnPoint);
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