// Builds the optimized GLB bundles the game loads from the CC0 KayKit packs.
// Usage: node tools/build-assets.mjs <kaykit-src-dir> [out-dir]
// (fetch the packs first with tools/fetch-assets.sh <kaykit-src-dir>)
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, resample, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const OUT = process.argv[3] ?? 'public/assets';
if (!SRC) {
  console.error('usage: node tools/build-assets.mjs <kaykit-src-dir> [out-dir]');
  process.exit(1);
}

const HEX = `${SRC}/KayKit-Medieval-Hexagon-Pack-1.0/addons/kaykit_medieval_hexagon_pack/Assets/gltf`;
const ADV = `${SRC}/KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures`;
const SKL = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons`;
const DUN = `${SRC}/KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf`;
const HAL = `${SRC}/KayKit-Halloween-Bits-1.0/addons/kaykit_halloween_bits/Assets/gltf`;

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const compress = () => meshopt({ encoder: MeshoptEncoder, level: 'medium' });

function dropAnimations(doc) {
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) ch.dispose();
    for (const s of anim.listSamplers()) s.dispose();
    anim.dispose();
  }
}
fs.mkdirSync(OUT, { recursive: true });

const ANIMATIONS = [
  'Idle', 'Idle_Combat', 'Walking_A', 'Walking_D_Skeletons', 'Running_A',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab',
  '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin',
  'Dualwield_Melee_Attack_Slice', 'Unarmed_Melee_Attack_Punch_A',
  '1H_Ranged_Shoot', '2H_Ranged_Shoot', 'Spellcast_Shoot', 'Spellcast_Raise', 'Spellcast_Summon',
  'Death_A', 'Death_B', 'Death_C_Skeletons', 'Hit_A', 'Cheer', 'Block', 'Throw', 'Use_Item',
  'Spawn_Ground_Skeletons',
];

/** Merge several model files into one GLB, each wrapped in a root node named after its key. */
async function pack(outName, entries) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  for (const [name, file] of entries) {
    if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
    const src = await io.read(file);
    dropAnimations(src);
    const map = mergeDocuments(doc, src);
    const srcScene = src.getRoot().listScenes()[0];
    const merged = map.get(srcScene);
    const group = doc.createNode(name);
    for (const child of merged.listChildren()) {
      merged.removeChild(child);
      group.addChild(child);
    }
    scene.addChild(group);
    merged.dispose();
  }
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(unpartition(), dedup(), weld(), prune({ keepLeaves: true }), compress());
  const out = path.join(OUT, outName);
  await io.write(out, doc);
  console.log(`${outName}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB (${entries.length} models)`);
}

async function characters() {
  const files = {
    Knight: `${ADV}/Characters/gltf/Knight.glb`,
    Barbarian: `${ADV}/Characters/gltf/Barbarian.glb`,
    Mage: `${ADV}/Characters/gltf/Mage.glb`,
    Rogue: `${ADV}/Characters/gltf/Rogue.glb`,
    Rogue_Hooded: `${ADV}/Characters/gltf/Rogue_Hooded.glb`,
    Skeleton_Minion: `${SKL}/Characters/gltf/Skeleton_Minion.glb`,
    Skeleton_Warrior: `${SKL}/Characters/gltf/Skeleton_Warrior.glb`,
    Skeleton_Mage: `${SKL}/Characters/gltf/Skeleton_Mage.glb`,
    Skeleton_Rogue: `${SKL}/Characters/gltf/Skeleton_Rogue.glb`,
  };
  fs.mkdirSync(path.join(OUT, 'chars'), { recursive: true });
  for (const [name, file] of Object.entries(files)) {
    const doc = await io.read(file);
    dropAnimations(doc);
    await doc.transform(dedup(), prune({ keepLeaves: true }), compress());
    const out = path.join(OUT, 'chars', `${name}.glb`);
    await io.write(out, doc);
    console.log(`chars/${name}.glb: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
}

/** All KayKit characters share the same rig, so one clip library drives every unit. */
async function animations() {
  const doc = await io.read(`${SKL}/Characters/gltf/Skeleton_Minion.glb`);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    if (ANIMATIONS.includes(anim.getName())) continue;
    for (const ch of anim.listChannels()) ch.dispose();
    for (const s of anim.listSamplers()) s.dispose();
    anim.dispose();
  }
  for (const node of root.listNodes()) {
    if (node.getMesh()) {
      node.setMesh(null);
      node.setSkin(null);
    }
  }
  await doc.transform(resample(), dedup(), prune({ keepLeaves: true }), compress());
  const missing = ANIMATIONS.filter((n) => !root.listAnimations().some((a) => a.getName() === n));
  if (missing.length) throw new Error(`missing animations: ${missing.join(', ')}`);
  const out = path.join(OUT, 'anims.glb');
  await io.write(out, doc);
  console.log(`anims.glb: ${(fs.statSync(out).size / 1024).toFixed(0)} KB (${root.listAnimations().length} clips)`);
}

const BUILDING_TYPES = [
  'castle', 'barracks', 'archeryrange', 'blacksmith', 'church', 'tavern', 'market', 'mine',
  'lumbermill', 'windmill', 'watermill', 'well', 'home_A', 'home_B',
  'tower_A', 'tower_B', 'tower_base', 'tower_catapult',
];

async function main() {
  await characters();
  await animations();

  // Colour variants only differ in which atlas cell the team-coloured parts sample, so the game
  // ships the blue set and repaints that cell per race at runtime.
  await pack('buildings.glb', BUILDING_TYPES.map((t) => [t, `${HEX}/buildings/blue/building_${t}_blue.gltf`]));

  const nature = [
    'tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_A_medium', 'trees_B_small', 'trees_B_medium',
    'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E',
    'hill_single_A', 'hill_single_B', 'mountain_A_grass_trees', 'mountain_B_grass_trees', 'cloud_small', 'cloud_big',
  ];
  const neutral = [
    'building_scaffolding', 'building_destroyed', 'building_grain', 'building_dirt',
    'projectile_catapult', 'fence_wood_straight', 'fence_stone_straight', 'wall_straight', 'wall_straight_gate',
  ];
  const props = ['barrel', 'crate_A_big', 'crate_B_small', 'bucket_arrows', 'flag_blue', 'flag_green', 'flag_red', 'flag_yellow'];
  await pack('env.glb', [
    ...nature.map((n) => [n, `${HEX}/decoration/nature/${n}.gltf`]),
    ...neutral.map((n) => [n, `${HEX}/buildings/neutral/${n}.gltf`]),
    ...props.map((n) => [n, `${HEX}/decoration/props/${n}.gltf`]),
  ]);

  const halloween = [
    'crypt', 'shrine', 'shrine_candles', 'gravestone', 'grave_A', 'gravemarker_A', 'tree_dead_large',
    'tree_dead_medium', 'tree_dead_small', 'post_skull', 'skull', 'ribcage', 'bone_A', 'lantern_standing',
    'pumpkin_orange_jackolantern', 'arch_gate', 'fence', 'fence_broken', 'coffin', 'tree_pine_orange_medium',
  ];
  await pack('halloween.glb', halloween.map((n) => [n, `${HAL}/${n}.gltf`]));

  const dungeon = [
    'banner_patternA_blue', 'banner_patternA_green', 'banner_patternA_yellow', 'banner_patternA_red', 'banner_patternA_white',
    'banner_shield_white', 'banner_thin_white', 'coin_stack_large', 'coin_stack_medium', 'coin', 'pillar_decorated', 'column',
    'keg_decorated', 'barrel_large', 'torch_lit', 'sword_shield_gold', 'chest_gold', 'rubble_large', 'trunk_medium_A',
  ];
  await pack(
    'dungeon.glb',
    dungeon.map((n) => {
      const a = `${DUN}/${n}.gltf.glb`;
      return [n, fs.existsSync(a) ? a : `${DUN}/${n}.glb`];
    }),
  );

  const sklWeapons = [
    'Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Crossbow', 'Skeleton_Staff', 'Skeleton_Shield_Large_A',
    'Skeleton_Shield_Large_B', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Small_B', 'Skeleton_Arrow', 'Skeleton_Quiver',
  ];
  const advWeapons = [
    'arrow', 'quiver', 'staff', 'wand', 'spellbook_open', 'sword_1handed', 'sword_2handed', 'sword_2handed_color',
    'axe_1handed', 'axe_2handed', 'crossbow_1handed', 'crossbow_2handed', 'dagger', 'shield_round_color', 'shield_spikes_color',
    'shield_badge_color', 'shield_square_color', 'smokebomb', 'mug_full',
  ];
  await pack('weapons.glb', [
    ...sklWeapons.map((n) => [n, `${SKL}/Assets/gltf/${n}.gltf`]),
    ...advWeapons.map((n) => [n, `${ADV}/Assets/gltf/${n}.gltf`]),
  ]);

  fs.copyFileSync(`${SRC}/KayKit-Medieval-Hexagon-Pack-1.0/LICENSE.txt`, path.join(OUT, 'LICENSE-KayKit.txt'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
