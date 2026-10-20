import * as THREE from 'three';

// World-space room bounds, in the original glTF coordinate system (metres).
export const rooms = [
    { id: 'living', position: [-3.3, 1.4, 0.1], min: [-5.72, 0, -2.7], max: [-0.98, 2.8, 4.05] },
    { id: 'eastRoom', position: [0.35, 1.35, 0.0], min: [-1.02, 0, -2.7], max: [1.99, 2.8, 1.98] },
    { id: 'eastBath', position: [0.25, 1.35, 2.9], min: [-1.02, 0, 1.92], max: [1.99, 2.8, 4.05] },
    { id: 'westRoom', position: [-6.65, 1.35, 0.5], min: [-8.26, 0, -2.7], max: [-5.66, 2.8, 2.68] },
    { id: 'westBath', position: [-6.8, 1.35, 3.35], min: [-8.26, 0, 2.62], max: [-5.66, 2.8, 4.05] },
];

export class ApartmentReflections {
    constructor(renderer, scene) {
        this.renderer = renderer; this.scene = scene;
        this.materials = []; this.targets = []; this.ready = false;
        this.pmrem = new THREE.PMREMGenerator(renderer);
    }
    register(material, roomId, mesh) {
        const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        const room = rooms.find(r => r.id === roomId) || rooms.find(r =>
            center.x >= r.min[0] && center.x <= r.max[0] && center.z >= r.min[2] && center.z <= r.max[2]) || rooms[0];
        this.materials.push({ material, room });
        material.onBeforeCompile = shader => {
            shader.uniforms.probePosition = { value: new THREE.Vector3(...room.position) };
            shader.uniforms.probeMin = { value: new THREE.Vector3(...room.min) };
            shader.uniforms.probeMax = { value: new THREE.Vector3(...room.max) };
            shader.vertexShader = 'varying vec3 vProbeWorld;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>',
                '#include <worldpos_vertex>\nvProbeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = `varying vec3 vProbeWorld;
                uniform vec3 probePosition; uniform vec3 probeMin; uniform vec3 probeMax;
                vec3 boxProjectedDirection(vec3 direction) {
                    vec3 safeDirection = mix(vec3(1.0), sign(direction), step(vec3(0.00001), abs(direction))) * max(abs(direction), vec3(0.00001));
                    vec3 origin = clamp(vProbeWorld, probeMin + 0.001, probeMax - 0.001);
                    vec3 hit = max((probeMax-origin)/safeDirection, (probeMin-origin)/safeDirection);
                    float distanceToWall = min(min(hit.x,hit.y),hit.z);
                    return origin + direction * distanceToWall - probePosition;
                }\n` + shader.fragmentShader;
            const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment
                .replace('return PI * envMapColor.rgb * envMapIntensity;', 'return vec3(0.0);')
                .replace('textureCubeUV( envMap, reflectVec, roughness )',
                    'textureCubeUV( envMap, boxProjectedDirection(reflectVec), roughness )');
            shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', chunk);
            if (material.userData.windowGlass) {
                // A thin pane: Fresnel reflection + straight-through transmission.
                // No screen-space refraction buffer or extra scene pass in either eye.
                shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
                    float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
                    float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
                    float glassAlpha = clamp(fresnel + 0.015, 0.0, 1.0);
                    gl_FragColor = vec4(outgoingLight / max(glassAlpha, 0.001), glassAlpha);`);
            }
        };
        material.customProgramCacheKey = () => 'apartment-probe-v1-' + Boolean(material.userData.windowGlass);
    }
    async load() {
        const loader = new THREE.CubeTextureLoader();
        const cubes = [];
        try {
            const results = await Promise.allSettled(rooms.map(room => loader.loadAsync(
                ['px','nx','py','ny','pz','nz'].map(face => `./reflections/${room.id}/${face}.jpg`))));
            for (const result of results) if (result.status === 'fulfilled') cubes.push(result.value);
            if (results.some(result => result.status === 'rejected')) throw new Error('A room reflection map is unavailable.');
            const resolution = matchMedia('(pointer: coarse)').matches ? 128 : 256;
            for (let i = 0; i < rooms.length; i++) {
                // Cap the PMREM allocation: five rooms occupy about 8 MB on
                // touch devices, or 32 MB on desktop, before driver overhead.
                cubes[i].images = cubes[i].images.map(image => {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = resolution;
                    canvas.getContext('2d').drawImage(image,0,0,resolution,resolution);
                    return canvas;
                });
                cubes[i].colorSpace = THREE.SRGBColorSpace;
                const target = this.pmrem.fromCubemap(cubes[i]);
                this.apply(rooms[i], target);
            }
            this.ready = true;
        } finally { for (const cube of cubes) cube.dispose(); this.pmrem.dispose(); }
    }
    fallback() {
        this.ready = false;
        for (const { material } of this.materials) {
            if (material.emissiveMap) material.emissiveIntensity = 1;
            material.envMapIntensity = 0;
        }
    }
    apply(room, target) {
        this.targets.push(target);
        for (const entry of this.materials) if (entry.room.id === room.id) {
            entry.material.envMap = target.texture; entry.material.needsUpdate = true;
        }
    }
    // Authoring only: ?capture=1 renders six directions once per room, before
    // reflective materials receive their maps. The deployed tour loads JPEGs.
    capture() {
        const size = 512, result = {};
        const renderer = this.renderer, scene = this.scene;
        const hidden = [], originals = [], temporary = [];
        scene.traverse(o => {
            if (o.isMesh && o.material.userData?.windowGlass) {
                hidden.push([o,o.visible]); o.visible = false;
            }
            if (o.isMesh && o.material && !o.material.userData?.windowGlass && o.name !== 'clip') {
                originals.push([o,o.material]);
                const unlit = m => {
                    if (!m.emissiveMap) return m;
                    const basic = new THREE.MeshBasicMaterial({ map: m.emissiveMap, side: m.side });
                    temporary.push(basic); return basic;
                };
                o.material = Array.isArray(o.material) ? o.material.map(unlit) : unlit(o.material);
            }
        });
        const oldXR = renderer.xr.enabled, oldTone = renderer.toneMapping;
        const previous = renderer.getRenderTarget();
        renderer.xr.enabled = false; renderer.toneMapping = THREE.NoToneMapping;
        try {
            for (const room of rooms) {
                const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.UnsignedByteType });
                target.texture.colorSpace = THREE.SRGBColorSpace;
                const camera = new THREE.CubeCamera(0.05, 250, target);
                camera.position.set(...room.position); camera.update(renderer, scene);
                result[room.id] = [];
                for (let face = 0; face < 6; face++) {
                    const pixels = new Uint8Array(size * size * 4);
                    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels, face);
                    result[room.id].push(Array.from(pixels));
                }
                this.apply(room, this.pmrem.fromCubemap(target.texture));
                target.dispose();
            }
        } finally {
            renderer.setRenderTarget(previous); renderer.xr.enabled = oldXR; renderer.toneMapping = oldTone;
            for (const [o,visible] of hidden) o.visible = visible;
            for (const [o,material] of originals) o.material = material;
            for (const material of temporary) material.dispose();
        }
        return { size, rooms: result };
    }
}
