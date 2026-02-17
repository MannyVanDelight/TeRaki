import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

// --- 1. CORE SETUP ---
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

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);

// VR RIG: Holds the camera and controllers
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace; 

// --- 2. VR ACTIVATION ---
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));
renderer.domElement.style.touchAction = 'none';

// --- 3. STATE & HOME LOGIC ---
let yaw = Math.PI, pitch = 0;
const homeData = { pos: new THREE.Vector3(0, 1.4, 8), yaw: Math.PI };
let clippingBox = new THREE.Box3();
let hasClipping = false;

function goHome() {
    if (renderer.xr.isPresenting) {
        cameraRig.position.copy(homeData.pos);
        cameraRig.rotation.set(0, 0, 0);
    } else {
        camera.position.copy(homeData.pos);
    }
    yaw = homeData.yaw; 
    pitch = 0;
}

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// --- 4. VR CONTROLLERS & TELEPORT SETUP ---
const controllerModelFactory = new XRControllerModelFactory();
const raycaster = new THREE.Raycaster();
let intersectPoint = null;

// Teleport Marker
const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 })
);
marker.visible = false;
scene.add(marker);

const controller1 = renderer.xr.getController(0);
controller1.addEventListener('selectstart', () => {
    if (intersectPoint && marker.visible) {
        // Teleport rig to the target floor point
        cameraRig.position.set(intersectPoint.x, intersectPoint.y, intersectPoint.z);
    }
});
cameraRig.add(controller1);

const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
cameraRig.add(grip1);

const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-5)]);
const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
controller1.add(line);

// --- 5. MODEL LOADING ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        if (isMain) {
            // A. START POSITION
            if (name.includes("start")) {
                homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
                const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());
                const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'YXZ');
                homeData.yaw = euler.y + Math.PI;
                child.visible = false;
                return;
            }
            
            // B. CLIPPING (Invisible Boundary)
            if (name.includes("clip")) {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                if(child.material) child.material.visible = false; 
                child.userData.isClip = true; 
                hasClipping = true;
                return;
            }

            // C. FLOOR (Navigation Surface)
            if (name.includes("floor")) {
                child.userData.isFloor = true; 
            }
        }

        if (child.isMesh) {
            if (child.material.map) {
                child.material.emissive = new THREE.Color(0xffffff);
                child.material.emissiveMap = child.material.map;
                child.material.emissiveIntensity = 1.0; 
                child.material.color = new THREE.Color(0x000000);
            }
        }
    });
    scene.add(gltf.scene);
    if (isMain) goHome();
}

loader.load('./models/TeRaki-05.glb', (gltf) => {
    processModel(gltf, true);
    const loaderDiv = document.getElementById('loader');
    if(loaderDiv) {
        loaderDiv.style.opacity = '0';
        setTimeout(() => loaderDiv.style.display = 'none', 500);
    }
});
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false));
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false));

// --- 6. ANIMATION & MOVEMENT ---
const keyStates = {};
let touchMode = null, lastTouchX = 0, lastTouchY = 0;

function updateDesktopCamera() {
    const target = new THREE.Vector3();
    const fX = Math.sin(yaw) * Math.cos(pitch);
    const fY = Math.sin(pitch);
    const fZ = Math.cos(yaw) * Math.cos(pitch);
    target.set(camera.position.x + fX, camera.position.y + fY, camera.position.z + fZ);
    camera.lookAt(target);
}

function handleVRRaycast() {
    if (!controller1) return;

    const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(scene.children, true);

    // 1. First, find a hit on the object tagged as "isFloor"
    const floorHit = intersects.find(hit => hit.object.userData.isFloor);

    if (floorHit) {
        // 2. Second, check if that point is inside the "clippingBox"
        if (!hasClipping || clippingBox.containsPoint(floorHit.point)) {
            intersectPoint = floorHit.point;
            marker.position.copy(intersectPoint);
            marker.visible = true;
            marker.material.color.set(0x00ff00); // Green
        } else {
            // Pointing at floor but it's outside the clip box
            marker.position.copy(floorHit.point);
            marker.visible = true;
            marker.material.color.set(0xff0000); // Red
            intersectPoint = null;
        }
    } else {
        marker.visible = false;
        intersectPoint = null;
    }
}

function animate() {
    if (renderer.xr.isPresenting) {
        handleVRRaycast();
    } else {
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
            const testPoint = new THREE.Vector3(nX, camera.position.y, nZ);
            if (!hasClipping || clippingBox.containsPoint(testPoint)) {
                camera.position.x = nX;
                camera.position.z = nZ;
            }
        }
        updateDesktopCamera();
    }
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

// --- 7. EVENTS ---
document.addEventListener('click', () => { 
    if (!renderer.xr.isPresenting && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        document.body.requestPointerLock();
    }
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
    if (renderer.xr.isPresenting) return;
    e.preventDefault();
    const t = e.touches[0];
    lastTouchX = t.pageX; lastTouchY = t.pageY;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
}, { passive: false });

renderer.domElement.addEventListener('touchmove', (e) => {
    if (renderer.xr.isPresenting) return;
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
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});