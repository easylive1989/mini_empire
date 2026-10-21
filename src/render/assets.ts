import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CharacterBase } from '../game/types';

export type PackName = 'buildings' | 'env' | 'halloween' | 'dungeon' | 'weapons';

export interface Assets {
  chars: Map<CharacterBase, THREE.Object3D>;
  clips: Map<string, THREE.AnimationClip>;
  packs: Map<PackName, Map<string, THREE.Object3D>>;
}

const CHARACTERS: CharacterBase[] = [
  'Knight',
  'Barbarian',
  'Mage',
  'Rogue',
  'Rogue_Hooded',
  'Skeleton_Minion',
  'Skeleton_Warrior',
  'Skeleton_Mage',
  'Skeleton_Rogue',
];
const PACKS: PackName[] = ['buildings', 'env', 'halloween', 'dungeon', 'weapons'];

function url(path: string): string {
  return `${import.meta.env.BASE_URL}assets/${path}`;
}

export async function loadAssets(onProgress: (done: number, total: number) => void): Promise<Assets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const total = CHARACTERS.length + PACKS.length + 1;
  let done = 0;
  const tick = () => onProgress(++done, total);

  const load = async (path: string) => {
    const gltf = await loader.loadAsync(url(path));
    tick();
    return gltf;
  };

  const [charGltfs, packGltfs, animGltf] = await Promise.all([
    Promise.all(CHARACTERS.map((c) => load(`chars/${c}.glb`))),
    Promise.all(PACKS.map((p) => load(`${p}.glb`))),
    load('anims.glb'),
  ]);

  const chars = new Map<CharacterBase, THREE.Object3D>();
  CHARACTERS.forEach((c, i) => chars.set(c, charGltfs[i].scene));

  const packs = new Map<PackName, Map<string, THREE.Object3D>>();
  PACKS.forEach((p, i) => {
    const map = new Map<string, THREE.Object3D>();
    for (const child of packGltfs[i].scene.children) map.set(child.name, child);
    packs.set(p, map);
  });

  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of animGltf.animations) clips.set(clip.name, clip);

  for (const scene of [...charGltfs, ...packGltfs].map((g) => g.scene)) {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }
  return { chars, clips, packs };
}

export function packItem(assets: Assets, pack: PackName, key: string): THREE.Object3D {
  const item = assets.packs.get(pack)?.get(key);
  if (!item) throw new Error(`missing model ${pack}/${key}`);
  return item;
}
