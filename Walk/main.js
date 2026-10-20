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
// On http:// or non-WebXR browsers three.js returns a plain link with no id — give it one
const vrButtonEl = VRButton.createButton(renderer);
if (!vrButtonEl.id) vrButtonEl.id = 'VRButton';
document.body.appendChild(vrButtonEl);

// --- 2. STATE ---
let yaw = 0, pitch = 0;
const homeData = { pos: new THREE.Vector3(), yaw: 0 };
let vrFloorY = 0;
let clippingBox = new THREE.Box3();
let hasClipping = false;

// Touch State (walkDirection is driven by the left-half touch "stick")
let walkDirection = 0;

function goHome() {
    cancelTeleport();
    if (renderer.xr.isPresenting) {
        vrHome();
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
const raycaster = new THREE.Raycaster();
const vrRaycaster = new THREE.Raycaster();
const floorMeshes = []; // meshes named "floor" — the only valid VR teleport targets
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

const markerGeo = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
const vrMarkers = [];

// Place the rig so the HEAD (not the play-space origin) lands on the target point
function placeHeadAt(x, y, z) {
    camera.getWorldPosition(_v);
    cameraRig.position.x += x - _v.x;
    cameraRig.position.z += z - _v.z;
    cameraRig.position.y = y;
}

function vrHome() {
    cameraRig.rotation.set(0, homeData.yaw, 0);
    cameraRig.position.set(homeData.pos.x, vrFloorY, homeData.pos.z);
    cameraRig.updateMatrixWorld(true);
    placeHeadAt(homeData.pos.x, vrFloorY, homeData.pos.z);
}

// Both controllers can aim + teleport; each gets a pointer ray and its own marker
const controllers = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
    );
    ray.scale.z = 5;
    c.add(ray);

    const m = new THREE.Mesh(markerGeo, markerMat);
    m.visible = false;
    scene.add(m);
    vrMarkers.push(m);

    c.userData.hitPoint = null;
    c.userData.marker = m;
    c.userData.ray = ray;
    c.addEventListener('selectstart', () => {
        const p = c.userData.hitPoint;
        if (p) placeHeadAt(p.x, p.y, p.z);
    });
    cameraRig.add(c);
    return c;
});

let vrRecentreFrames = 0;
function hideVRMarkers() { vrMarkers.forEach(m => { m.visible = false; }); }

// Ping ring shown where a touch / click teleport lands
const pingRing = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.26, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })
);
pingRing.renderOrder = 10;
pingRing.visible = false;
scene.add(pingRing);
let pingLife = 0;

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
                child.traverse(o => { if (o.isMesh) { o.userData.isVRFloor = true; floorMeshes.push(o); } });
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
    const hits = raycaster.intersectObjects(scene.children, true).filter(h => h.object !== pingRing && !vrMarkers.includes(h.object));
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
        if (vrRecentreFrames > 0 && --vrRecentreFrames === 0) vrHome();

        // Only the (invisible) floor meshes are raycast — cheap enough for standalone headsets
        for (const c of controllers) {
            const m = c.userData.marker;
            c.userData.hitPoint = null;
            m.visible = false;
            if (!c.visible || !floorMeshes.length) continue;

            _m.extractRotation(c.matrixWorld);
            vrRaycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
            vrRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(_m);
            const hit = vrRaycaster.intersectObjects(floorMeshes, false)[0];
            if (!hit) { c.userData.ray.scale.z = 5; continue; }

            c.userData.ray.scale.z = hit.distance;
            // Respect the same walkable bounds as desktop/touch
            if (hasClipping && !clippingBox.containsPoint(_v.set(hit.point.x, homeData.pos.y, hit.point.z))) continue;

            c.userData.hitPoint = hit.point.clone();
            m.position.copy(hit.point);
            m.position.y += 0.01;
            m.visible = true;
        }

    } else {
        const speed = 1.5; // units per second
        let moveF = 0, moveS = 0;

        if (keyStates['KeyW'] || keyStates['ArrowUp']) moveF += 1;
        if (keyStates['KeyS'] || keyStates['ArrowDown']) moveF -= 1;
        if (keyStates['KeyA'] || keyStates['ArrowLeft']) moveS -= 1;
        if (keyStates['KeyD'] || keyStates['ArrowRight']) moveS += 1;

        if (walkDirection !== 0) moveF = walkDirection;

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

// Input mode follows whatever the person is actually using. The old check
// (maxTouchPoints / 'ontouchstart') flagged touchscreen laptops and many
// desktop browsers as "touch" and switched the mouse off entirely.
// Headset browsers (Quest, Pico, Wolvic) report a "coarse" pointer like phones — never treat them as mobile
const isHeadsetBrowser = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
let inputMode = (!isHeadsetBrowser && window.matchMedia('(pointer: coarse)').matches) ? 'touch' : 'mouse';
document.body.classList.toggle('touch', inputMode === 'touch');
function setInputMode(mode) {
    if (mode === inputMode) return;
    inputMode = mode;
    document.body.classList.toggle('touch', mode === 'touch');
    if (mode === 'touch') {
        bottomHint.classList.remove('show');
        crosshair.classList.remove('show');
    }
}
window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') setInputMode('touch');
    else if (e.pointerType === 'mouse' || e.pointerType === 'pen') setInputMode('mouse');
}, { capture: true, passive: true });
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
    if (inputMode === 'touch') showTouchHints(4500);
    else showBottomHint('Click the scene to look around · or click-drag', 5000);
}

function showTouchHints(ms) {
    touchHints.classList.add('show');
    clearTimeout(hintTimer);
    if (ms) hintTimer = setTimeout(() => touchHints.classList.remove('show'), ms);
}
function hideTouchHints() { clearTimeout(hintTimer); touchHints.classList.remove('show'); }

let bottomTimer = null;
function showBottomHint(text, ms) {
    if (inputMode === 'touch') return;
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
    // Work out WHY VR is unavailable, so the button/menu can say so
    let vrReason = '';
    let xrError = '';
    let embedded = false;
    try { embedded = window.self !== window.top; } catch (err) { embedded = true; }
    const policyAllows = (document.featurePolicy && document.featurePolicy.allowsFeature)
        ? document.featurePolicy.allowsFeature('xr-spatial-tracking') : null;
    if (!window.isSecureContext) {
        vrReason = 'VR needs HTTPS';
    } else if (!navigator.xr || !navigator.xr.isSessionSupported) {
        vrReason = 'Browser has no WebXR';
    } else if (policyAllows === false) {
        vrReason = 'VR blocked by embed';
    } else {
        try { vrSupported = await navigator.xr.isSessionSupported('immersive-vr'); }
        catch (err) { vrSupported = false; xrError = (err && (err.name + ': ' + err.message)) || String(err); }
        if (!vrSupported) vrReason = (xrError && embedded) ? 'VR blocked by embed' : 'VR not detected';
        // Headset switched on / Link started after the page loaded → reload once it appears
        navigator.xr.addEventListener('devicechange', async () => {
            let now = false;
            try { now = await navigator.xr.isSessionSupported('immersive-vr'); } catch (err) {}
            if (now && !vrSupported) location.reload();
        });
    }
    const yes = (b) => (b ? 'yes' : 'no');
    const vrDiag = 'Details — address: ' + location.protocol + '//' + location.host +
        ' · secure: ' + yes(window.isSecureContext) +
        ' · WebXR: ' + yes(!!navigator.xr) +
        ' · embedded: ' + yes(embedded) +
        ' · xr policy: ' + (policyAllows === null ? 'n/a' : yes(policyAllows)) +
        ' · headset browser: ' + yes(isHeadsetBrowser) +
        (xrError ? ' · error: ' + xrError : '') +
        ' · result: ' + (vrSupported ? 'supported' : vrReason);
    console.info('[tour] ' + vrDiag + ' | UA: ' + navigator.userAgent);
    document.body.classList.toggle('vr-off', !vrSupported);
    const vrBtn = document.getElementById('VRButton') || document.getElementById('XRButton');
    if (vrBtn) {
        const tidy = () => {
            const txt = (vrBtn.textContent || '').toUpperCase();
            if (!vrSupported || txt.includes('NOT')) {
                const label = vrReason || 'VR not detected';
                if (vrBtn.textContent !== label) vrBtn.textContent = label;
                vrBtn.onclick = null; // VRButton otherwise navigates to an external WebXR page
                vrBtn.style.cursor = 'default';
                document.body.classList.add('vr-off');
            }
        };
        new MutationObserver(tidy).observe(vrBtn, { childList: true, characterData: true, subtree: true });
        tidy();
        vrBtn.addEventListener('click', (e) => {
            if (vrSupported) return;
            e.preventDefault(); e.stopPropagation();
            showBottomHint(vrReason === 'VR needs HTTPS'
                ? 'This page is on plain http:// — browsers only allow VR on https:// or localhost'
                : vrReason === 'Browser has no WebXR'
                ? 'This browser has no WebXR — use Chrome, Edge or the Meta Quest Browser'
                : vrReason === 'VR blocked by embed'
                ? 'The page embedding this tour blocks VR — open the tour on its own'
                : 'No headset detected — start Link (or put the headset on) and the page will reload', 5000);
        }, true);
    }
    const vrTab = document.getElementById('tab-vr');
    const badge = document.getElementById('mode-badge');
    const vrStatus = document.getElementById('vr-status');

    if (!vrSupported) {
        // Tab stays enabled so the reason below can actually be read
        vrStatus.textContent = vrReason === 'VR needs HTTPS'
            ? 'VR is blocked because this page is served over plain http://. Browsers only allow WebXR on https:// addresses (or http://localhost on the same machine).'
            : vrReason === 'Browser has no WebXR'
            ? 'This browser does not support WebXR. Use Chrome or Edge on PC (with Link running), or the Meta Quest Browser in the headset.'
            : vrReason === 'VR blocked by embed'
            ? 'This tour is embedded in another page that does not allow VR. Add allow="xr-spatial-tracking; fullscreen" to the <iframe> tag, or open the tour on its own.'
            : 'No headset detected. On PC, start Link and make Meta Horizon Link the active OpenXR runtime — the page reloads by itself when the headset appears.';
    } else {
        vrStatus.textContent = 'A headset was detected on this device — you are ready to go.';
    }
    // Always show the raw check results under the message, so problems can be pinned down
    const diagEl = document.createElement('span');
    diagEl.style.cssText = 'display:block;margin-top:8px;font-family:var(--mono);font-size:10.5px;line-height:1.5;word-break:break-word;';
    diagEl.textContent = vrDiag;
    vrStatus.appendChild(diagEl);

    if (vrSupported || isHeadsetBrowser) { if (badge) badge.textContent = vrSupported ? 'VR headset ready' : 'VR check'; setTab('vr'); }
    else if (inputMode === 'touch') { if (badge) badge.textContent = 'Touch controls'; setTab('touch'); }
    else { if (badge) badge.textContent = 'Mouse & keyboard'; setTab('desktop'); }
})();

// --- 7. EVENT LISTENERS ---
const dom = renderer.domElement;
const isLocked = () => document.pointerLockElement === document.body;
const clampPitch = () => { pitch = Math.max(-1.5, Math.min(1.5, pitch)); };

// ---- Desktop mouse ----
// Click (no drag) = capture the mouse for free-look.
// Click-and-drag = look around without capturing (also the fallback when
// pointer lock is blocked, e.g. inside an iframe or right after Esc in Chrome).
// Double-click = teleport (at the centre dot when captured, at the cursor when not).
const drag = { id: null, x: 0, y: 0, sx: 0, sy: 0, moved: false, type: 'mouse' };
let lastClickTime = 0, lastClickX = 0, lastClickY = 0;
let lockTimer = null;

function handleClickAt(x, y) {
    const now = performance.now();
    const near = Math.hypot(x - lastClickX, y - lastClickY) < 40;
    if (now - lastClickTime < 360 && near) {
        lastClickTime = 0;
        if (!teleportFromScreen(x, y)) showBottomHint('Aim at the floor to teleport', 2000);
        return true; // was a double-click
    }
    lastClickTime = now; lastClickX = x; lastClickY = y;
    return false;
}

function requestLock() {
    if (!document.body.requestPointerLock) return;
    try {
        const p = document.body.requestPointerLock();
        if (p && p.catch) p.catch(() => showBottomHint('Drag to look around · double-click the floor to teleport', 3500));
    } catch (err) { /* fall back to drag-look */ }
}

document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (menuOpen || renderer.xr.isPresenting) return;

    if (isLocked()) {
        handleClickAt(window.innerWidth / 2, window.innerHeight / 2);
        return;
    }
    if (e.target !== dom) return; // on-screen UI, menu, VR button
    drag.id = e.pointerId; drag.type = e.pointerType;
    drag.x = drag.sx = e.clientX; drag.y = drag.sy = e.clientY;
    drag.moved = false;
    try { dom.setPointerCapture(e.pointerId); } catch (err) {}
    cancelTeleport();
});

document.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag.id || isLocked()) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
        drag.moved = true;
        dom.style.cursor = 'grabbing';
    }
    if (drag.moved) {
        yaw -= (e.clientX - drag.x) * 0.004;
        pitch -= (e.clientY - drag.y) * 0.004;
        clampPitch();
    }
    drag.x = e.clientX; drag.y = e.clientY;
});

function endDrag(e) {
    if (e.pointerId !== drag.id) return;
    const wasClick = !drag.moved && e.type === 'pointerup';
    drag.id = null;
    dom.style.cursor = '';
    if (!wasClick || menuOpen || renderer.xr.isPresenting) return;
    const wasDouble = handleClickAt(e.clientX, e.clientY);
    clearTimeout(lockTimer);
    // Single click with a real mouse captures it for free-look — after the
    // double-click window, so a double-click at the cursor still teleports
    if (!wasDouble && drag.type === 'mouse' && !isLocked()) {
        lockTimer = setTimeout(() => { if (!menuOpen && !renderer.xr.isPresenting) requestLock(); }, 380);
    }
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

document.addEventListener('pointerlockchange', () => {
    const locked = isLocked();
    crosshair.classList.toggle('show', locked && inputMode === 'mouse');
    if (locked) showBottomHint('Double-click the floor to teleport · Esc releases the cursor', 4000);
    else if (!menuOpen) showBottomHint('Click the scene to look around · or click-drag', 4000);
});
document.addEventListener('pointerlockerror', () => {
    showBottomHint('Drag to look around · double-click the floor to teleport', 3500);
});

document.addEventListener('mousemove', (e) => {
    if (!isLocked()) return;
    // Clamp occasional spikes some browsers report under pointer lock
    const dx = Math.max(-150, Math.min(150, e.movementX || 0));
    const dy = Math.max(-150, Math.min(150, e.movementY || 0));
    yaw -= dx * 0.002;
    pitch -= dy * 0.002;
    clampPitch();
});

document.addEventListener('keydown', (e) => {
    keyStates[e.code] = true;
    if (e.code === 'Escape' && menuOpen) closeMenu();
    if ((e.code === 'Slash' && e.shiftKey) || e.code === 'KeyH') menuOpen ? closeMenu() : openMenu();
    // Stop arrow keys / space from activating a focused button behind the scene
    if (!menuOpen && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => { keyStates[e.code] = false; });
// Clear held keys if the window loses focus (otherwise you keep walking)
window.addEventListener('blur', () => { for (const k in keyStates) keyStates[k] = false; });

// ---- Touch (two independent thumbs: left = walk, right = look) ----
const walkT = { id: null, startY: 0 };
const lookT = { id: null, x: 0, y: 0 };
let tapStart = null;
let lastTap = { x: 0, y: 0, time: 0 };

dom.addEventListener('touchstart', (e) => {
    if (menuOpen || renderer.xr.isPresenting) return;
    e.preventDefault(); // no synthetic mouse events / zoom
    setInputMode('touch');
    cancelTeleport();

    for (const t of e.changedTouches) {
        const leftSide = t.clientX < window.innerWidth / 2;
        if (leftSide && walkT.id === null) {
            walkT.id = t.identifier; walkT.startY = t.clientY;
            zoneLeft.classList.add('active');
        } else if (!leftSide && lookT.id === null) {
            lookT.id = t.identifier; lookT.x = t.clientX; lookT.y = t.clientY;
            zoneRight.classList.add('active');
        }
    }

    const t0 = e.changedTouches[0];
    tapStart = e.touches.length === 1
        ? { id: t0.identifier, x: t0.clientX, y: t0.clientY, time: performance.now(), moved: false }
        : null;
    showTouchHints(0);
}, { passive: false });

dom.addEventListener('touchmove', (e) => {
    if (menuOpen || renderer.xr.isPresenting) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
        if (tapStart && t.identifier === tapStart.id &&
            Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > 14) tapStart.moved = true;

        if (t.identifier === walkT.id) {
            const deltaY = walkT.startY - t.clientY;
            walkDirection = deltaY > 20 ? 1 : deltaY < -20 ? -1 : 0;
        } else if (t.identifier === lookT.id) {
            yaw -= (t.clientX - lookT.x) * 0.005;
            pitch -= (t.clientY - lookT.y) * 0.005;
            clampPitch();
            lookT.x = t.clientX; lookT.y = t.clientY;
        }
    }
}, { passive: false });

function onTouchEnd(e) {
    let tapped = null;
    for (const t of e.changedTouches) {
        if (t.identifier === walkT.id) { walkT.id = null; walkDirection = 0; zoneLeft.classList.remove('active'); }
        if (t.identifier === lookT.id) { lookT.id = null; zoneRight.classList.remove('active'); }
        if (tapStart && t.identifier === tapStart.id) tapped = tapStart;
    }
    if (e.touches.length === 0) showTouchHints(2500);
    if (e.type !== 'touchend' || !tapped || menuOpen || renderer.xr.isPresenting) return;
    tapStart = null;

    const now = performance.now();
    if (tapped.moved || now - tapped.time >= 260) return;

    const closeToLast = Math.hypot(tapped.x - lastTap.x, tapped.y - lastTap.y) < 40;
    if (now - lastTap.time < 320 && closeToLast) {
        lastTap.time = 0;
        if (!teleportFromScreen(tapped.x, tapped.y)) showTouchHints(2500);
    } else {
        lastTap = { x: tapped.x, y: tapped.y, time: now };
    }
}
dom.addEventListener('touchend', onTouchEnd);
dom.addEventListener('touchcancel', onTouchEnd);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

renderer.xr.addEventListener('sessionstart', () => {
    if (menuOpen) closeMenu();
    hideTouchHints();
    bottomHint.classList.remove('show');
    cancelTeleport();
    walkDirection = 0;
    for (const k in keyStates) keyStates[k] = false;
    // Start the headset at the entrance, facing the right way. The real head
    // pose only arrives with the first XR frames, so re-centre once it has.
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    vrHome();
    vrRecentreFrames = 3;
});

renderer.xr.addEventListener('sessionend', () => {
    hideVRMarkers();
    goHome();
    setTimeout(onWindowResize, 100);
});
