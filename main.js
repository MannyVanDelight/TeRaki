import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// 1. Setup Scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 2. Add Lighting (Crucial or your model will be black)
scene.background = new THREE.Color(0x808080); // Makes the background grey
const ambientLight = new THREE.AmbientLight(0xffffff, 1); 
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(10, 10, 10);
scene.add(directionalLight);

// 3. Add Interaction (Pivot/Zoom)
const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 5, 15);
controls.update();

// 4. Load the Model
const testBox = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff0000 })
);
scene.add(testBox);
const loader = new GLTFLoader();
loader.load('./models/TeRaki-05.glb', (gltf) => {
    const model = gltf.scene;
    scene.add(model);

    // --- DIAGNOSTIC LOGIC ---
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Move the camera to fit the model in view
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 4 * Math.tan(fov * 2));
    
    cameraZ *= 3; // Zoom out a bit more
    camera.position.z = cameraZ;
    camera.lookAt(center);
    
    if (controls) {
        controls.target.copy(center);
        controls.update();
    }
    // ------------------------

    console.log("Model loaded! Dimensions:", size);
}, undefined, (error) => {
    console.error(error);
});

// 5. Animation Loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();