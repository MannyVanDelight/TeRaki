import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ApartmentReflections } from './reflections.js';
import { prepareMaterials, refinishInBox } from './materials.js';

// Surfaces to re-finish inside a box (world metres). The fridge shares the kitchen's lacquer
// mesh, but its baked texture is streaky — give it the laptop's brushed-metal treatment.
const REFINISH = [
    { label: 'fridge', fromSurface: 'lacquer', room: 'living',
      box: [[-5.70, -0.02, -0.79], [-4.95, 1.99, -0.04]],
      finish: { surface: 'metal', color: 0xe2e5e8, metalness: 1, roughness: 0.32, strength: 1.0, baked: 0.12 } },
];

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

// Create the WebGL context VR-ready on the high-performance GPU up front. Otherwise
// entering VR has to migrate the context to the headset's GPU mid-way, which can stall
// on PCs with two GPUs (headset shows "loading" forever).
const glCanvas = document.createElement('canvas');
const glContext = glCanvas.getContext('webgl2', { antialias: true, xrCompatible: true, powerPreference: 'high-performance' });
const renderer = glContext
    ? new THREE.WebGLRenderer({ canvas: glCanvas, context: glContext, antialias: true, powerPreference: 'high-performance' })
    : new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Per-room reflection probes (pre-captured cube maps) layered over the baked lighting
const reflections = new ApartmentReflections(renderer, scene);
let assetsReady = false;
// Own Enter VR button (replaces three.js's VRButton, which stalls silently and then
// lets a second click request a second session → "already an active immersive XRSession")
const vrButtonEl = document.createElement('button');
vrButtonEl.id = 'VRButton';
vrButtonEl.textContent = 'Enter VR';
document.body.appendChild(vrButtonEl);
let vrEyeOffset = 0;            // lift applied to the rig so the eyes sit at a standing height
const VR_EYE_HEIGHT = 1.65;     // target eye height (m) for seated users / missing floor data
const VR_MIN_REAL_HEIGHT = 1.45; // real head heights below this get lifted to VR_EYE_HEIGHT

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
    cameraRig.position.y = y + vrEyeOffset;
}

// Floor level for VR teleport when the model has no mesh named "floor"
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitP = new THREE.Vector3();
function detectFloorHeight(root) {
    // Look straight down from the start point for the first upward-facing surface
    const down = new THREE.Raycaster(homeData.pos.clone(), new THREE.Vector3(0, -1, 0), 0, 10);
    root.updateMatrixWorld(true);
    const targets = floorMeshes.length ? floorMeshes : [root];
    const hit = down.intersectObjects(targets, true).find(h => h.face &&
        h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.6);
    vrFloorY = hit ? hit.point.y : homeData.pos.y - 1.6;
    floorPlane.constant = -vrFloorY;
    console.info('[tour] VR floor height:', vrFloorY.toFixed(3), hit ? '(from ' + hit.object.name + ')' : '(estimated)');
}
// One full raycast on trigger press: is a wall between the controller and the target?
const blockRay = new THREE.Raycaster();
function vrPathBlocked(c, target) {
    blockRay.ray.origin.setFromMatrixPosition(c.matrixWorld);
    blockRay.ray.direction.copy(target).sub(blockRay.ray.origin);
    const dist = blockRay.ray.direction.length();
    blockRay.ray.direction.normalize();
    blockRay.far = dist - 0.05;
    const hits = blockRay.intersectObjects(scene.children, true).filter(h =>
        h.object.isMesh && h.object !== pingRing && !vrMarkers.includes(h.object) &&
        h.object.visible && h.object.material && h.object.material.visible !== false);
    // Something solid in the way that isn't itself floor-like → blocked
    return hits.some(h => !h.face || h.face.normal.clone().transformDirection(h.object.matrixWorld).y < 0.6);
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

    const m = new THREE.Mesh(markerGeo, markerMat.clone()); // own material so it can flash red
    m.visible = false;
    scene.add(m);
    vrMarkers.push(m);

    c.userData.hitPoint = null;
    c.userData.marker = m;
    c.userData.ray = ray;
    c.addEventListener('selectstart', () => {
        const p = c.userData.hitPoint;
        if (!p) return;
        if (vrPathBlocked(c, p)) {    // don't teleport through walls/furniture
            c.userData.blockedUntil = performance.now() + 450;
            return;
        }
        placeHeadAt(p.x, p.y, p.z);
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

        // Floors tagged in the model (material extras: surface = "floor") are the teleport targets
        if (child.isMesh && child.material && child.material.userData && child.material.userData.surface === 'floor') {
            child.userData.isVRFloor = true;
            floorMeshes.push(child);
        }
    });
    scene.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    prepareMaterials(gltf.scene, reflections, gltf.userData && gltf.userData.background);
    for (const r of REFINISH) {
        const n = refinishInBox(gltf.scene, r, reflections);
        if (n) console.info('[tour] refinished ' + r.label + ': ' + n + ' triangles');
    }
    if (isMain) { detectFloorHeight(gltf.scene); goHome(); }
}

function hideLoader() {
    const el = document.getElementById('loader');
    if (!el || el.classList.contains('gone')) return;
    el.classList.add('gone');
    setTimeout(() => { el.style.display = 'none'; }, 700);
}

async function loadApartment() {
    const status = document.querySelector('#loader p');
    try {
        const files = ['TeRaki-05-pbr.glb', 'furniture01-pbr.glb', 'bg01.glb', 'glass-pbr.glb'];
        const models = await Promise.all(files.map(file => loader.loadAsync('./models/' + file)));
        models.forEach((gltf, i) => {
            gltf.userData = { background: i === 2 };
            processModel(gltf, i === 0);
        });
        if (new URLSearchParams(location.search).has('capture')) {
            // Authoring only: ?capture renders the room probes instead of loading the JPEGs
            window.captureApartmentReflections = () => reflections.capture();
        } else {
            status.textContent = 'Preparing reflections';
            try { await reflections.load(); }
            catch (error) {
                console.warn('Reflection maps unavailable; baked tour remains usable.', error);
                reflections.fallback();
                const notice = document.getElementById('reflection-notice');
                if (notice) notice.hidden = false;
            }
        }
        assetsReady = true;
        window.dispatchEvent(new Event('apartment-ready'));
        hideLoader();
    } catch (error) {
        console.error('Apartment assets could not be loaded.', error);
        status.textContent = 'The apartment could not load. Please reload to try again.';
        document.querySelector('#loader .spinner').style.display = 'none';
        const retry = document.createElement('button');
        retry.className = 'pill'; retry.textContent = 'Reload tour';
        retry.addEventListener('click', () => location.reload());
        document.getElementById('loader').appendChild(retry);
    }
}
loadApartment();

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

    // With tagged floors: the first solid thing under the cursor must be a floor
    if (floorMeshes.length) {
        const first = hits.find(h => h.object.isMesh && h.object.visible && h.object.material && h.object.material.visible !== false);
        return first && first.object.userData.isVRFloor ? first.point.clone() : null;
    }

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

// --- VR diagnostics: count frames actually sent to the headset, catch silent errors ---
let xrFrames = 0;
let vrAttemptAt = 0;
let xrStatusTimer = null;
let lastFrameError = '';
function reportVRProblem(msg) {
    console.warn('[tour] VR problem:', msg);
    showBottomHint('VR problem: ' + msg, 15000);
}
function vrErrorRelevant() { return renderer.xr.isPresenting || (performance.now() - vrAttemptAt < 60000 && vrAttemptAt > 0); }
window.addEventListener('unhandledrejection', (e) => {
    if (!vrErrorRelevant()) return;
    const r = e.reason;
    reportVRProblem((r && (r.name + ' — ' + r.message)) || String(r));
});
window.addEventListener('error', (e) => {
    if (!vrErrorRelevant()) return;
    reportVRProblem(e.message || String(e.error));
});

function animate() {
    try { animateFrame(); }
    catch (err) {
        const msg = (err && (err.name + ' — ' + err.message)) || String(err);
        if (msg !== lastFrameError) { lastFrameError = msg; reportVRProblem('frame error: ' + msg); console.error(err); }
    }
}

function animateFrame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (renderer.xr.isPresenting) { xrFrames++; if (xrFrames === 1) { vrT.first = performance.now(); console.info('[tour] VR timeline:', vrTimeline()); } }

    if (renderer.xr.isPresenting) {
        if (vrRecentreFrames > 0 && --vrRecentreFrames === 0) {
            // Measure the real head height above the play-space floor (camera is local to the rig).
            // Seated users or a low Link floor read as child height → lift them to standing eye height.
            const h = camera.position.y;
            vrEyeOffset = h < VR_MIN_REAL_HEIGHT ? VR_EYE_HEIGHT - h : 0;
            console.info('[tour] VR head height ' + h.toFixed(2) + ' m → lift ' + vrEyeOffset.toFixed(2) + ' m');
            vrHome();
        }

        // Aim: a mesh named "floor" if the model has one, otherwise a flat plane at the
        // detected floor height (cheap — no per-frame raycast against the whole model)
        for (const c of controllers) {
            const m = c.userData.marker;
            c.userData.hitPoint = null;
            m.visible = false;
            if (!c.visible) continue;

            _m.extractRotation(c.matrixWorld);
            vrRaycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
            vrRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(_m);
            let hit = null;
            if (floorMeshes.length) {
                hit = vrRaycaster.intersectObjects(floorMeshes, false)[0] || null;
            } else if (vrRaycaster.ray.intersectPlane(floorPlane, _hitP)) {
                const d = _hitP.distanceTo(vrRaycaster.ray.origin);
                if (d < 20) hit = { point: _hitP.clone(), distance: d };
            }
            if (!hit) { c.userData.ray.scale.z = 5; continue; }

            c.userData.ray.scale.z = hit.distance;
            // Respect the same walkable bounds as desktop/touch
            if (hasClipping && !clippingBox.containsPoint(_v.set(hit.point.x, homeData.pos.y, hit.point.z))) continue;

            c.userData.hitPoint = hit.point.clone();
            m.position.copy(hit.point);
            m.position.y += 0.01;
            m.material.color.setHex(performance.now() < (c.userData.blockedUntil || 0) ? 0xff3b30 : 0x00ff00);
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
    const vrDiag = 'Details — address: ' + location.href.split('?')[0] +
        ' · secure: ' + yes(window.isSecureContext) +
        ' · WebXR: ' + yes(!!navigator.xr) +
        ' · embedded: ' + yes(embedded) +
        ' · xr policy: ' + (policyAllows === null ? 'n/a' : yes(policyAllows)) +
        ' · headset browser: ' + yes(isHeadsetBrowser) +
        (xrError ? ' · error: ' + xrError : '') +
        ' · result: ' + (vrSupported ? 'supported' : vrReason) +
        ' · browser: ' + navigator.userAgent;
    console.info('[tour] ' + vrDiag + ' | UA: ' + navigator.userAgent);
    document.body.classList.toggle('vr-off', !vrSupported);
    const vrBtn = document.getElementById('VRButton') || document.getElementById('XRButton');
    if (vrBtn) {
        const tidy = () => {
            const txt = (vrBtn.textContent || '').toUpperCase();
            if (!vrSupported || txt.includes('NOT')) {
                const label = vrReason === 'VR blocked by embed' ? 'Open in new tab for VR'
                    : vrReason === 'VR not detected' ? 'No headset found' : 'VR not available';
                if (vrBtn.textContent !== label) vrBtn.textContent = label;
                vrBtn.onclick = null; // VRButton otherwise navigates to an external WebXR page
                vrBtn.style.cursor = vrReason === 'VR blocked by embed' ? 'pointer' : 'default';
                document.body.classList.add('vr-off');
            }
        };
        new MutationObserver(tidy).observe(vrBtn, { childList: true, characterData: true, subtree: true });
        tidy();
        vrBtn.addEventListener('click', (e) => {
            if (vrSupported) return; // startVR() handles it
            e.preventDefault(); e.stopPropagation();
            // Embedded without VR permission: open the tour on its own, where VR is allowed
            if (vrReason === 'VR blocked by embed') {
                const a = document.createElement('a');
                a.href = location.href; a.target = '_blank'; a.rel = 'noopener';
                document.body.appendChild(a); a.click(); a.remove();
                showBottomHint('If no tab opened, paste this into the address bar: ' + location.href, 8000);
                return;
            }
            showBottomHint(vrReason === 'VR needs HTTPS'
                ? 'VR needs the secure (https) address of this tour'
                : vrReason === 'Browser has no WebXR'
                ? 'This browser can’t show VR — try Chrome, Edge or your headset’s browser'
                : vrReason === 'VR blocked by embed'
                ? 'The page embedding this tour blocks VR — open the tour on its own'
                : 'No headset found — open the tour in your headset’s browser, or connect it with Quest Link', 5000);
        }, true);
    }
    const vrTab = document.getElementById('tab-vr');
    const badge = document.getElementById('mode-badge');
    const vrStatus = document.getElementById('vr-status');

    if (!vrSupported) {
        // Tab stays enabled so the reason below can actually be read
        vrStatus.textContent = vrReason === 'VR needs HTTPS'
            ? 'VR isn’t available on this version of the page. Open the tour from its secure (https) address to use a headset.'
            : vrReason === 'Browser has no WebXR'
            ? 'This browser can’t show VR. Use Chrome or Edge on a PC with a headset connected, or open the tour in your headset’s own browser.'
            : vrReason === 'VR blocked by embed'
            ? 'VR can’t start inside this page. Use the button below to open the tour on its own — VR works there.'
            : 'No headset found. Easiest: open this page in your headset’s own browser. On a PC, connect the headset with Quest Link first — this page notices it and reloads by itself.';
    } else {
        vrStatus.textContent = 'A headset was detected on this device — you are ready to go.';
    }
    // Always show the raw check results under the message, so problems can be pinned down
    // Technical details only for troubleshooting: add ?debug to the address
    if (new URLSearchParams(location.search).has('debug')) {
        const diagEl = document.createElement('span');
        diagEl.style.cssText = 'display:block;margin-top:8px;font-family:var(--mono);font-size:10.5px;line-height:1.5;word-break:break-word;';
        diagEl.textContent = vrDiag;
        vrStatus.appendChild(diagEl);
    }

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

// --- Enter / exit VR, one step at a time, each with a timeout and a clear message ---
let xrSession = null;
let xrStarting = false;
// Stopwatch for each VR start-up step (seconds since the Enter VR click)
const vrT = {};
const vrSince = (k) => vrT[k] != null ? ((vrT[k] - vrT.click) / 1000).toFixed(1) + 's' : '—';
function vrTimeline() {
    return 'allowed ' + vrSince('granted') + ' · gpu ' + vrSince('gpu') + ' · floor ' + vrSince('ref') +
        ' · view ' + vrSince('ready') + ' · first frame ' + vrSince('first');
}
function withTimeout(promise, ms, step) {
    return Promise.race([promise, new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out while ' + step)), ms))]);
}
async function startVR() {
    if (!vrSupported) return;                      // unsupported case is handled by the hint listener
    if (xrSession) { xrSession.end(); return; }    // button doubles as Exit VR
    if (xrStarting) { showBottomHint('VR is already starting — check the headset', 3000); return; }

    xrStarting = true;
    vrAttemptAt = performance.now();
    for (const k in vrT) delete vrT[k];
    vrT.click = performance.now();
    vrButtonEl.textContent = 'Starting VR…';
    showBottomHint('Allow VR if the browser asks, then put the headset on', 8000);
    let session = null;
    try {
        // No timeout here: the browser's permission prompt can take as long as the person needs
        session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
        vrT.granted = performance.now();

        const gl = renderer.getContext();
        const attrs = gl.getContextAttributes();
        if (!attrs || !attrs.xrCompatible) {
            await withTimeout(gl.makeXRCompatible(), 10000, 'connecting the graphics card to the headset (set the browser to the High performance GPU in Windows graphics settings)');
        }

        vrT.gpu = performance.now();
        let refType = 'local-floor';
        try { await withTimeout(session.requestReferenceSpace('local-floor'), 5000, 'setting up floor tracking'); }
        catch (e) { refType = 'local'; }
        vrT.ref = performance.now();
        vrEyeOffset = refType === 'local' ? VR_EYE_HEIGHT : 0; // refined from the real head height once tracking settles
        renderer.xr.setReferenceSpaceType(refType);

        await withTimeout(renderer.xr.setSession(session), 10000, 'starting the VR view');
        vrT.ready = performance.now();
        xrSession = session;
        session.addEventListener('end', () => { xrSession = null; vrButtonEl.textContent = 'Enter VR'; });
        vrButtonEl.textContent = 'Exit VR';
        console.info('[tour] VR started (' + refType + ')');
    } catch (err) {
        const msg = (err && err.name === 'InvalidStateError')
            ? 'another VR session is still open — close other tabs that used VR, or restart the browser, then try again'
            : (err && err.message) ? err.message : String(err);
        reportVRProblem(msg);
        // Release a half-started session so the next click can try again cleanly
        if (session) { try { await session.end(); } catch (e) {} }
        vrButtonEl.textContent = 'Enter VR';
    } finally {
        xrStarting = false;
    }
}
vrButtonEl.addEventListener('click', startVR);

renderer.xr.addEventListener('sessionstart', () => {
    // Live readout on the desktop screen while the headset is in VR
    xrFrames = 0;
    clearInterval(xrStatusTimer);
    const started = performance.now();
    xrStatusTimer = setInterval(() => {
        const secs = Math.round((performance.now() - started) / 1000);
        const ref = renderer.xr.getReferenceSpace() ? 'yes' : 'no';
        if (xrFrames === 0) {
            showBottomHint('Waiting for the headset to ask for the first frame · ' + secs + 's · ' + vrTimeline(), 1500);
        } else {
            const fps = Math.round(xrFrames / Math.max(1, (performance.now() - vrT.first) / 1000));
            const eye = camera.getWorldPosition(_v).y - vrFloorY;
            showBottomHint('VR running · eye height ' + eye.toFixed(2) + ' m (real ' + camera.position.y.toFixed(2) +
                ' m + lift ' + vrEyeOffset.toFixed(2) + ' m) · ' + fps + ' fps · ' + vrTimeline(), 1500);
        }
    }, 1000);
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
    vrRecentreFrames = 15; // a few frames so the headset pose is valid before measuring height
});

renderer.xr.addEventListener('sessionend', () => {
    clearInterval(xrStatusTimer);
    vrAttemptAt = 0;
    hideVRMarkers();
    goHome();
    setTimeout(onWindowResize, 100);
});

if (new URLSearchParams(location.search).has('debug')) {
    window.apartmentDebug = {
        scene, camera, renderer, reflections,
        get ready() { return assetsReady; },
        view(position, target) {
            camera.position.set(...position);
            const direction = new THREE.Vector3(...target).sub(camera.position).normalize();
            yaw = Math.atan2(direction.x, direction.z); pitch = Math.asin(direction.y);
            updateCameraRotation();
        },
        goHome,
    };
}
