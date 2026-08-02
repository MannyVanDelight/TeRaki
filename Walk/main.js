import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

// --- 1. CORE SETUP ---
const scene = new THREE.Scene();

// Gradient Background
const bgCanvas = document.createElement('canvas');
bgCanvas.width = 2; bgCanvas.height = 512;
const context = bgCanvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 0, 512);
gradient.addColorStop(0, '#e0e0e0');
gradient.addColorStop(1, '#444444');
context.fillStyle = gradient;
context.fillRect(0, 0, 2, 512);
scene.background = new THREE.CanvasTexture(bgCanvas);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
const cameraRig = new THREE.Group();
cameraRig.add(camera);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// --- 2. STATE ---
let yaw = 0, pitch = 0;
const homeData = { pos: new THREE.Vector3(), yaw: 0 };
let vrFloorY = 0;
let clippingBox = new THREE.Box3();
let hasClipping = false;

// Touch State
let touchMode = null;
let lastTouchX = 0, lastTouchY = 0;
let walkDirection = 0;

function goHome() {
    cancelTeleport();
    if (renderer.xr.isPresenting) {
        cameraRig.position.set(homeData.pos.x, vrFloorY, homeData.pos.z);
        cameraRig.rotation.set(0, homeData.yaw, 0);
    } else {
        camera.position.copy(homeData.pos);
        cameraRig.position.set(0, 0, 0);
        cameraRig.rotation.set(0, 0, 0);
        yaw = homeData.yaw + Math.PI;
        pitch = 0;
        updateCameraRotation();
    }
}

// --- 3. VR & ASSETS ---
const controller1 = renderer.xr.getController(0);
const raycaster = new THREE.Raycaster();
let intersectPoint = null;

const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 })
);
marker.visible = false;
scene.add(marker);

// Ping ring shown where a touch / click teleport lands
const pingRing = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.26, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })
);
pingRing.renderOrder = 10;
pingRing.visible = false;
scene.add(pingRing);
let pingLife = 0;

controller1.addEventListener('selectstart', () => {
    if (intersectPoint && marker.visible) {
        cameraRig.position.set(intersectPoint.x, intersectPoint.y, intersectPoint.z);
    }
});
cameraRig.add(controller1);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function processModel(gltf, isMain) {
    gltf.scene.traverse((child) => {
        const name = child.name.toLowerCase();

        if (isMain) {
            if (name.includes("start")) {
                homeData.pos.copy(child.getWorldPosition(new THREE.Vector3()));
                const euler = new THREE.Euler().setFromQuaternion(child.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
                homeData.yaw = euler.y;
                child.visible = false;
            }
            if (name.includes("clip")) {
                child.geometry.computeBoundingBox();
                child.updateMatrixWorld();
                clippingBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                if (child.material) child.material.visible = false;
                hasClipping = true;
            }
            if (name === "floor") {
                vrFloorY = child.getWorldPosition(new THREE.Vector3()).y;
                child.userData.isVRFloor = true;
                if (child.material) child.material.visible = false;
            }
        }

        if (child.isMesh && child.material && child.material.map) {
            child.material.emissive = new THREE.Color(0xffffff);
            child.material.emissiveMap = child.material.map;
            child.material.emissiveIntensity = 1.0;
            child.material.color = new THREE.Color(0x000000);
        }
    });
    scene.add(gltf.scene);
    if (isMain) goHome();
}

function hideLoader() {
    const el = document.getElementById('loader');
    if (!el || el.classList.contains('gone')) return;
    el.classList.add('gone');
    setTimeout(() => { el.style.display = 'none'; }, 700);
}

loader.load('./models/TeRaki-05.glb', (gltf) => {
    processModel(gltf, true);
    hideLoader();
}, undefined, () => hideLoader());
loader.load('./models/furniture01.glb', (gltf) => processModel(gltf, false), undefined, () => {});
loader.load('./models/bg01.glb', (gltf) => processModel(gltf, false), undefined, () => {});

// --- 4. TELEPORT (touch double-tap / mouse double-click) ---
const teleport = { active: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0 };
const TELEPORT_TIME = 0.28; // seconds

function cancelTeleport() { teleport.active = false; }

function pickFloorPoint(clientX, clientY) {
    const ndc = new THREE.Vector2(
        (clientX / window.innerWidth) * 2 - 1,
        -(clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(scene.children, true).filter(h => h.object !== marker && h.object !== pingRing);
    if (!hits.length) return null;

    // Prefer the dedicated invisible floor helper, then any near-horizontal surface below eye level
    const floorHit = hits.find(h => h.object.userData.isVRFloor);
    if (floorHit) return floorHit.point.clone();

    const flat = hits.find(h => {
        if (!h.face) return false;
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        return n.y > 0.6 && h.point.y < camera.position.y - 0.3;
    });
    return flat ? flat.point.clone() : null;
}

function teleportTo(point) {
    if (!point) return false;
    const target = new THREE.Vector3(point.x, camera.position.y, point.z);
    if (hasClipping && !clippingBox.containsPoint(target)) return false;

    teleport.from.copy(camera.position);
    teleport.to.copy(target);
    teleport.t = 0;
    teleport.active = true;

    pingRing.position.set(point.x, point.y + 0.02, point.z);
    pingRing.visible = true;
    pingLife = 1;
    return true;
}

function teleportFromScreen(clientX, clientY) {
    return teleportTo(pickFloorPoint(clientX, clientY));
}

// --- 5. MOVEMENT ENGINE ---
const keyStates = {};
const clock = new THREE.Clock();

function updateCameraRotation() {
    const fX = Math.sin(yaw) * Math.cos(pitch);
    const fY = Math.sin(pitch);
    const fZ = Math.cos(yaw) * Math.cos(pitch);
    camera.lookAt(camera.position.x + fX, camera.position.y + fY, camera.position.z + fZ);
}

function animate() {
    const dt = Math.min(clock.getDelta(), 0.1);

    if (renderer.xr.isPresenting) {
        const tempMatrix = new THREE.Matrix4().extractRotation(controller1.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller1.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const hit = raycaster.intersectObjects(scene.children, true).find(h => h.object.userData.isVRFloor);
        if (hit) {
            intersectPoint = hit.point; marker.position.copy(hit.point); marker.visible = true;
        } else { marker.visible = false; }

    } else {
        const speed = 1.5; // units per second
        let moveF = 0, moveS = 0;

        if (keyStates['KeyW'] || keyStates['ArrowUp']) moveF += 1;
        if (keyStates['KeyS'] || keyStates['ArrowDown']) moveF -= 1;
        if (keyStates['KeyA'] || keyStates['ArrowLeft']) moveS -= 1;
        if (keyStates['KeyD'] || keyStates['ArrowRight']) moveS += 1;

        if (touchMode === 'WALK') moveF = walkDirection;

        if (moveF !== 0 || moveS !== 0) {
            cancelTeleport();
            const fX = Math.sin(yaw), fZ = Math.cos(yaw);
            const rX = Math.sin(yaw - Math.PI / 2), rZ = Math.cos(yaw - Math.PI / 2);

            const nX = camera.position.x + (fX * moveF + rX * moveS) * speed * dt;
            const nZ = camera.position.z + (fZ * moveF + rZ * moveS) * speed * dt;

            if (!hasClipping || clippingBox.containsPoint(new THREE.Vector3(nX, camera.position.y, nZ))) {
                camera.position.x = nX; camera.position.z = nZ;
            }
        }

        if (teleport.active) {
            teleport.t = Math.min(1, teleport.t + dt / TELEPORT_TIME);
            const e = teleport.t < 0.5 ? 2 * teleport.t * teleport.t : 1 - Math.pow(-2 * teleport.t + 2, 2) / 2;
            camera.position.lerpVectors(teleport.from, teleport.to, e);
            if (teleport.t >= 1) teleport.active = false;
        }

        updateCameraRotation();
    }

    if (pingLife > 0) {
        pingLife = Math.max(0, pingLife - dt / 0.8);
        pingRing.material.opacity = pingLife * 0.85;
        const s = 1 + (1 - pingLife) * 1.6;
        pingRing.scale.set(s, s, s);
        if (pingLife === 0) pingRing.visible = false;
    }

    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// --- 6. UI ---
const scrim = document.getElementById('scrim');
const helpBtn = document.getElementById('help-btn');
const bottomHint = document.getElementById('bottom-hint');
const bottomHintText = document.getElementById('bottom-hint-text');
const crosshair = document.getElementById('crosshair');
const touchHints = document.getElementById('touch-hints');
const zoneLeft = document.getElementById('zone-left');
const zoneRight = document.getElementById('zone-right');

const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.body.classList.toggle('touch', isTouch);
let vrSupported = false;
let menuOpen = true;
let hintTimer = null;

function setTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
}
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => { e.stopPropagation(); setTab(tab.dataset.tab); });
});

function openMenu() {
    menuOpen = true;
    scrim.classList.remove('hidden');
    helpBtn.classList.remove('nudge');
    hideTouchHints();
    bottomHint.classList.remove('show');
    if (document.pointerLockElement) document.exitPointerLock();
}

function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    scrim.classList.add('hidden');
    helpBtn.classList.add('nudge');
    if (isTouch) showTouchHints(4500);
    else showBottomHint('Click the scene to look around', 5000);
}

function showTouchHints(ms) {
    touchHints.classList.add('show');
    clearTimeout(hintTimer);
    if (ms) hintTimer = setTimeout(() => touchHints.classList.remove('show'), ms);
}
function hideTouchHints() { clearTimeout(hintTimer); touchHints.classList.remove('show'); }

let bottomTimer = null;
function showBottomHint(text, ms) {
    if (isTouch) return;
    bottomHintText.textContent = text;
    bottomHint.classList.add('show');
    clearTimeout(bottomTimer);
    if (ms) bottomTimer = setTimeout(() => bottomHint.classList.remove('show'), ms);
}

helpBtn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
document.getElementById('menu-close').addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); });
document.getElementById('menu-start').addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); });
scrim.addEventListener('click', (e) => { if (e.target === scrim) closeMenu(); });

document.getElementById('home-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    goHome();
});

// Detect input mode and preselect the right tab
(async function detectMode() {
    if (navigator.xr && navigator.xr.isSessionSupported) {
        try { vrSupported = await navigator.xr.isSessionSupported('immersive-vr'); } catch (err) { vrSupported = false; }
    }
    document.body.classList.toggle('vr-off', !vrSupported);
    const vrTab = document.getElementById('tab-vr');
    const badge = document.getElementById('mode-badge');
    const vrStatus = document.getElementById('vr-status');

    if (!vrSupported) {
        vrTab.disabled = true;
        vrStatus.textContent = 'No headset detected on this device. Open this tour in a VR browser and the Enter VR button appears automatically.';
    } else {
        vrStatus.textContent = 'A headset was detected on this device — you are ready to go.';
    }

    if (vrSupported) { badge.textContent = 'VR headset ready'; setTab('vr'); }
    else if (isTouch) { badge.textContent = 'Touch controls'; setTab('touch'); }
    else { badge.textContent = 'Mouse & keyboard'; setTab('desktop'); }
})();

// --- 7. EVENT LISTENERS ---
const dom = renderer.domElement;

// Click the scene to capture the mouse (desktop)
dom.addEventListener('click', () => {
    if (menuOpen || renderer.xr.isPresenting || isTouch) return;
    if (!document.pointerLockElement) {
        const p = document.body.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
    }
});

// Desktop double-click teleport — detected manually so it also works while the pointer is locked
let lastClickTime = 0, lastClickX = 0, lastClickY = 0;
dom.addEventListener('mousedown', (e) => {
    if (menuOpen || renderer.xr.isPresenting || isTouch || e.button !== 0) return;
    const locked = document.pointerLockElement === document.body;
    const x = locked ? window.innerWidth / 2 : e.clientX;
    const y = locked ? window.innerHeight / 2 : e.clientY;
    const now = performance.now();
    const near = Math.hypot(x - lastClickX, y - lastClickY) < 40;

    if (now - lastClickTime < 360 && near) {
        lastClickTime = 0;
        if (!teleportFromScreen(x, y)) showBottomHint('Aim at the floor to teleport', 2000);
    } else {
        lastClickTime = now; lastClickX = x; lastClickY = y;
    }
});

document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === document.body;
    crosshair.classList.toggle('show', locked && !isTouch);
    if (locked) showBottomHint('Double-click the floor to teleport · Esc releases the cursor', 4000);
    else if (!menuOpen && !isTouch) showBottomHint('Click the scene to look around', 4000);
});

document.addEventListener('keydown', (e) => {
    keyStates[e.code] = true;
    if (e.code === 'Escape' && menuOpen) closeMenu();
    if ((e.code === 'Slash' && e.shiftKey) || e.code === 'KeyH') menuOpen ? closeMenu() : openMenu();
});
document.addEventListener('keyup', (e) => keyStates[e.code] = false);

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
    }
});

// --- Mobile Touch ---
let tapStart = { x: 0, y: 0, time: 0, moved: false };
let lastTap = { x: 0, y: 0, time: 0 };

dom.addEventListener('touchstart', (e) => {
    if (menuOpen) return;
    const t = e.touches[0];
    lastTouchY = t.pageY;
    lastTouchX = t.pageX;
    touchMode = (t.pageX < window.innerWidth / 2) ? 'WALK' : 'LOOK';
    tapStart = { x: t.pageX, y: t.pageY, time: performance.now(), moved: false };
    cancelTeleport();

    showTouchHints(0);
    (touchMode === 'WALK' ? zoneLeft : zoneRight).classList.add('active');
}, { passive: false });

dom.addEventListener('touchmove', (e) => {
    if (menuOpen) return;
    e.preventDefault();
    const t = e.touches[0];

    if (Math.hypot(t.pageX - tapStart.x, t.pageY - tapStart.y) > 14) tapStart.moved = true;

    if (touchMode === 'LOOK') {
        yaw -= (t.pageX - lastTouchX) * 0.005;
        pitch -= (t.pageY - lastTouchY) * 0.005;
        pitch = Math.max(-1.5, Math.min(1.5, pitch));
        lastTouchX = t.pageX;
        lastTouchY = t.pageY;
    } else if (touchMode === 'WALK') {
        const deltaY = lastTouchY - t.pageY;
        if (deltaY > 20) walkDirection = 1;
        else if (deltaY < -20) walkDirection = -1;
        else walkDirection = 0;
    }
}, { passive: false });

dom.addEventListener('touchend', (e) => {
    touchMode = null;
    walkDirection = 0;
    zoneLeft.classList.remove('active');
    zoneRight.classList.remove('active');
    showTouchHints(2500);
    if (menuOpen || renderer.xr.isPresenting) return;

    const now = performance.now();
    const isTap = !tapStart.moved && (now - tapStart.time) < 260;
    if (!isTap) return;

    const closeToLast = Math.hypot(tapStart.x - lastTap.x, tapStart.y - lastTap.y) < 40;
    if (now - lastTap.time < 320 && closeToLast) {
        lastTap.time = 0;
        if (!teleportFromScreen(tapStart.x, tapStart.y)) showTouchHints(2500);
    } else {
        lastTap = { x: tapStart.x, y: tapStart.y, time: now };
    }
});

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

renderer.xr.addEventListener('sessionstart', () => {
    if (menuOpen) closeMenu();
    hideTouchHints();
});

renderer.xr.addEventListener('sessionend', () => {
    goHome();
    setTimeout(onWindowResize, 100);
});
