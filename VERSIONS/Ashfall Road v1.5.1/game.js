/* =========================================================
   ASHFALL ROAD — game.js
   A self-contained text RPG: classes, stats, inventory,
   procedural loot, mana & spells, branching travel, towns
   with shops/inns/a wizard's tower, combat, and endings.
   ========================================================= */

/* ---------------------------------------------------------
   0. small utilities
   --------------------------------------------------------- */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function clampPct(cur, max) { if (max <= 0) return 0; return clamp(Math.round((cur / max) * 100), 0, 100); }

let _uidCounter = 1;
function uid() { return 'itm' + (_uidCounter++); }

function weightedPick(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* ---------------------------------------------------------
   0b. critical hits
   --------------------------------------------------------- */
// Universal baseline — every class and every monster can land (or suffer)
// a critical hit. Gear, buffs, and future class kits (Rogue, enchantments)
// can add on top of these via the `critChance` / `critDamage` mod keys,
// which computeStats() already aggregates the same way it does every
// other stat, so nothing else needs to change when that content lands.
const BASE_CRIT_CHANCE = 0.08;   // 8% baseline for the player
const BASE_CRIT_DAMAGE = 1.6;    // critical hits deal 160% of their rolled power
const MONSTER_BASE_CRIT_CHANCE = 0.06; // monsters crit a little less often than players
const COUNTER_CRIT_BONUS = 0.25; // counterattacks are easier to land a crit with

/* ---------------------------------------------------------
   1. classes
   --------------------------------------------------------- */
const CLASSES = {
  warrior: {
    id: 'warrior', name: 'Warrior', icon: '\u2694\uFE0F',
    tagline: 'Steel and discipline',
    description: "A well-rounded fighter, equally at home holding a line or breaking one. Warriors wear the heaviest armor the road allows and rely on the sword.",
    baseAttack: 7, baseDefense: 5, baseSpeed: 5, baseMaxHp: 36, baseMaxMana: 0,
    baseCritChance: BASE_CRIT_CHANCE, baseCritDamage: BASE_CRIT_DAMAGE,
    weaponTypes: ['sword'],
    armorTypes: ['leather', 'chain', 'plate'],
    startWeapon: 'shortsword', startArmor: 'leather_armor',
  },
  mage: {
    id: 'mage', name: 'Mage', icon: '\u{1FA84}',
    tagline: 'Power at a price',
    description: "Frail without a spell ready, formidable with one. Mages draw on mana to hurl fire and bend fortune, but can only bear light robes and a staff.",
    baseAttack: 3, baseDefense: 2, baseSpeed: 5, baseMaxHp: 24, baseMaxMana: 24,
    baseCritChance: BASE_CRIT_CHANCE, baseCritDamage: BASE_CRIT_DAMAGE,
    weaponTypes: ['staff'],
    armorTypes: ['leather', 'robes'],
    startWeapon: 'apprentice_staff', startArmor: 'leather_armor',
    startingSpells: ['firebolt', 'frostlance', 'arcane_shield', 'life_tap'],
    manaPerLevel: 4,
  },
  berserker: {
    id: 'berserker', name: 'Berserker', icon: '\u{1FA93}',
    tagline: 'Blood and fury',
    description: "Hits harder than anyone else on the road, and can afford to, because they rarely stop to defend. Berserkers wield axes and shrug off armor that slows them down.",
    baseAttack: 8, baseDefense: 3, baseSpeed: 6, baseMaxHp: 32, baseMaxMana: 0,
    baseCritChance: BASE_CRIT_CHANCE, baseCritDamage: BASE_CRIT_DAMAGE,
    weaponTypes: ['axe'],
    armorTypes: ['leather', 'pelt'],
    startWeapon: 'hatchet', startArmor: 'leather_armor',
  },
  rogue: {
    id: 'rogue', name: 'Rogue', icon: '\u{1F977}',
    tagline: 'Quick hands, quicker blade',
    description: "Lives and dies by the opening, not the strongest hit but the one nobody saw coming. Rogues favor daggers, keep to light leathers, and trust speed over armor.",
    baseAttack: 6, baseDefense: 3, baseSpeed: 8, baseMaxHp: 28, baseMaxMana: 0,
    baseCritChance: 0.18, baseCritDamage: BASE_CRIT_DAMAGE,
    weaponTypes: ['dagger'],
    armorTypes: ['leather', 'shadow'],
    startWeapon: 'switchblade', startArmor: 'leather_armor',
  },
  spellsword: {
    id: 'spellsword', name: 'Spellsword', icon: '\u2728',
    tagline: 'Steel first, magic close behind',
    description: "Neither a true warrior nor a true mage, and better for it. Spellswords fight with an enchanted blade and a handful of simple spells, trading a deep spellbook for a sharper edge.",
    baseAttack: 6, baseDefense: 3, baseSpeed: 6, baseMaxHp: 26, baseMaxMana: 14,
    baseCritChance: BASE_CRIT_CHANCE, baseCritDamage: BASE_CRIT_DAMAGE,
    weaponTypes: ['blade'],
    armorTypes: ['leather', 'robes'],
    startWeapon: 'spellblade', startArmor: 'leather_armor',
    startingSpells: ['firebolt', 'arcane_shield'],
    manaPerLevel: 2,
  },
};

/* ---------------------------------------------------------
   2. item & rarity data
   --------------------------------------------------------- */
const RARITIES = [
  { id: 'common',   label: 'Common',   mult: 1.0, valueMult: 1.0, weight: 58, prefix: null },
  { id: 'uncommon', label: 'Uncommon', mult: 1.4, valueMult: 1.7, weight: 26, prefix: 'Fine' },
  { id: 'rare',     label: 'Rare',     mult: 1.9, valueMult: 2.8, weight: 12, prefix: 'Superior' },
  { id: 'epic',     label: 'Epic',     mult: 2.6, valueMult: 4.5, weight: 4,  prefix: 'Masterwork' },
];

const ITEM_TEMPLATES = [
  // -- swords (warrior) --
  { id: 'shortsword', name: 'Shortsword', type: 'weapon', slot: 'weapon', weaponType: 'sword', baseValue: 14, icon: '\u2694\uFE0F', desc: 'Light and quick, easy to carry.', statRanges: { attack: [2, 4], speed: [1, 2] } },
  { id: 'longsword', name: 'Longsword', type: 'weapon', slot: 'weapon', weaponType: 'sword', baseValue: 18, icon: '\u2694\uFE0F', desc: "A knight's standard, balanced and true.", statRanges: { attack: [3, 6] } },
  { id: 'broadsword', name: 'Broadsword', type: 'weapon', slot: 'weapon', weaponType: 'sword', baseValue: 22, icon: '\u2694\uFE0F', desc: 'Wide of blade and heavy of purpose.', statRanges: { attack: [4, 7], speed: [-1, 0] } },
  { id: 'rapier', name: 'Rapier', type: 'weapon', slot: 'weapon', weaponType: 'sword', baseValue: 20, icon: '\u2694\uFE0F', desc: "Built for the fencer's precise thrust.", statRanges: { attack: [2, 5], speed: [2, 3] } },
  // -- axes (berserker) --
  { id: 'hatchet', name: 'Hatchet', type: 'weapon', slot: 'weapon', weaponType: 'axe', baseValue: 14, icon: '\u{1FA93}', desc: 'A camp tool turned weapon.', statRanges: { attack: [2, 5], speed: [0, 1] } },
  { id: 'battleaxe', name: 'Battleaxe', type: 'weapon', slot: 'weapon', weaponType: 'axe', baseValue: 20, icon: '\u{1FA93}', desc: 'Two-handed and unforgiving.', statRanges: { attack: [4, 8], speed: [-2, -1] } },
  { id: 'greataxe', name: 'Greataxe', type: 'weapon', slot: 'weapon', weaponType: 'axe', baseValue: 26, icon: '\u{1FA93}', desc: 'Nearly as tall as its wielder.', statRanges: { attack: [6, 10], speed: [-3, -2] } },
  { id: 'tomahawk', name: 'Tomahawk', type: 'weapon', slot: 'weapon', weaponType: 'axe', baseValue: 16, icon: '\u{1FA93}', desc: 'Light enough to throw, if you dared.', statRanges: { attack: [2, 4], speed: [1, 2] } },
  // -- staffs (mage) --
  { id: 'apprentice_staff', name: 'Apprentice Staff', type: 'weapon', slot: 'weapon', weaponType: 'staff', baseValue: 16, icon: '\u{1FA84}', desc: "A student's first focus.", statRanges: { attack: [1, 3], maxMana: [2, 5] } },
  { id: 'runed_staff', name: 'Runed Staff', type: 'weapon', slot: 'weapon', weaponType: 'staff', baseValue: 22, icon: '\u{1FA84}', desc: 'Carved with looping sigils.', statRanges: { attack: [2, 4], maxMana: [4, 7] } },
  { id: 'archstaff', name: 'Archstaff', type: 'weapon', slot: 'weapon', weaponType: 'staff', baseValue: 30, icon: '\u{1FA84}', desc: 'Hums faintly, even at rest.', statRanges: { attack: [3, 6], maxMana: [6, 10] } },
  { id: 'bonestaff', name: 'Bonestaff', type: 'weapon', slot: 'weapon', weaponType: 'staff', baseValue: 26, icon: '\u{1FA84}', desc: 'Carved from something best not asked about.', statRanges: { attack: [3, 5], maxHp: [-3, -1], maxMana: [5, 9] } },
  // -- daggers (rogue) --
  { id: 'switchblade', name: 'Switchblade', type: 'weapon', slot: 'weapon', weaponType: 'dagger', baseValue: 15, icon: '\u{1F5E1}\uFE0F', desc: 'Snaps open faster than most can react.', statRanges: { attack: [1, 3], speed: [2, 3] } },
  { id: 'stiletto', name: 'Stiletto', type: 'weapon', slot: 'weapon', weaponType: 'dagger', baseValue: 17, icon: '\u{1F5E1}\uFE0F', desc: 'Thin, precise, and not meant to be seen coming.', statRanges: { attack: [2, 4] } },
  { id: 'serrated_kris', name: 'Serrated Kris', type: 'weapon', slot: 'weapon', weaponType: 'dagger', baseValue: 19, icon: '\u{1F5E1}\uFE0F', desc: 'A wavy, toothed blade that leaves a worse wound than it should.', statRanges: { attack: [3, 5], speed: [-1, 0] } },
  { id: 'twin_fang', name: 'Twin Fang', type: 'weapon', slot: 'weapon', weaponType: 'dagger', baseValue: 21, icon: '\u{1F5E1}\uFE0F', desc: 'Paired blades, balanced for a quick exchange.', statRanges: { attack: [2, 4], speed: [1, 2] } },
  // -- blades (spellsword) --
  { id: 'spellblade', name: 'Spellblade', type: 'weapon', slot: 'weapon', weaponType: 'blade', baseValue: 16, icon: '\u2694\uFE0F', desc: 'A simple blade, humming faintly with stored intent.', statRanges: { attack: [1, 3], maxMana: [2, 4] } },
  { id: 'runeblade', name: 'Runeblade', type: 'weapon', slot: 'weapon', weaponType: 'blade', baseValue: 20, icon: '\u2694\uFE0F', desc: 'Etched hilt to tip with runes that drink in spare magic.', statRanges: { attack: [2, 4], maxMana: [3, 6] } },
  { id: 'warded_blade', name: 'Warded Blade', type: 'weapon', slot: 'weapon', weaponType: 'blade', baseValue: 19, icon: '\u2694\uFE0F', desc: 'Wrapped in a ward that occasionally turns a blow meant for its wielder.', statRanges: { attack: [2, 3], defense: [1, 2] } },
  { id: 'battlemage_edge', name: "Battlemage's Edge", type: 'weapon', slot: 'weapon', weaponType: 'blade', baseValue: 23, icon: '\u2694\uFE0F', desc: "Built for someone who'd rather finish a fight with steel than spellwork.", statRanges: { attack: [3, 6], speed: [-1, 0] } },
  // -- armor --
  { id: 'leather_armor', name: 'Leather Armor', type: 'armor', slot: 'armor', armorType: 'leather', baseValue: 12, icon: '\u{1F9E5}', desc: 'Supple hide, stitched for travel.', statRanges: { defense: [1, 3], speed: [0, 1] } },
  { id: 'chain_armor', name: 'Chainmail', type: 'armor', slot: 'armor', armorType: 'chain', baseValue: 22, icon: '\u26D3\uFE0F', desc: 'Interlocking rings turn aside a glancing blow.', statRanges: { defense: [3, 6], speed: [-1, 0] } },
  { id: 'plate_armor', name: 'Plate Armor', type: 'armor', slot: 'armor', armorType: 'plate', baseValue: 36, icon: '\u{1F6E1}\uFE0F', desc: 'Cold, heavy, and reassuring.', statRanges: { defense: [6, 10], speed: [-3, -1] } },
  { id: 'mage_robes', name: "Mage's Robes", type: 'armor', slot: 'armor', armorType: 'robes', baseValue: 18, icon: '\u{1F458}', desc: 'Threadbare, but woven with quiet wards.', statRanges: { defense: [1, 2], maxMana: [3, 6] } },
  { id: 'pelt_armor', name: 'Pelt Armor', type: 'armor', slot: 'armor', armorType: 'pelt', baseValue: 14, icon: '\u{1F43E}', desc: "Crude, but the beast didn't need it anymore.", statRanges: { defense: [2, 4], attack: [0, 1] } },
  { id: 'shadow_garb', name: 'Shadow Garb', type: 'armor', slot: 'armor', armorType: 'shadow', baseValue: 16, icon: '\u{1F9E3}', desc: 'Dyed dark and cut close, built to not be noticed.', statRanges: { defense: [1, 2], speed: [1, 3] } },
  // -- trinkets (all classes) --
  { id: 'ring', name: 'Ring', type: 'trinket', slot: 'trinket', baseValue: 20, icon: '\u{1F48D}', desc: 'A plain band, warmer than it should be.', statRanges: { attack: [0, 2], defense: [0, 2], speed: [0, 2] } },
  { id: 'amulet', name: 'Amulet', type: 'trinket', slot: 'trinket', baseValue: 28, icon: '\u{1F4FF}', desc: 'Etched with a ward against small dooms.', statRanges: { maxHp: [3, 8] } },
  // -- consumables --
  { id: 'potion', name: 'Health Potion', type: 'consumable', baseValue: 8, icon: '\u{1F9EA}', desc: 'A common tonic.', effect: { heal: 15 } },
  { id: 'greater_potion', name: 'Greater Health Potion', type: 'consumable', baseValue: 18, icon: '\u2697\uFE0F', desc: 'A stronger brew.', effect: { heal: 35 } },
  { id: 'elixir_might', name: 'Elixir of Might', type: 'consumable', baseValue: 15, icon: '\u{1F525}', desc: 'Tastes of iron and ambition.', effect: { buff: { stat: 'attack', amount: 4, turns: 5 } } },
  { id: 'elixir_guard', name: 'Elixir of Guard', type: 'consumable', baseValue: 15, icon: '\u{1F6E1}\uFE0F', desc: 'Thickens the skin, briefly.', effect: { buff: { stat: 'defense', amount: 4, turns: 5 } } },
  { id: 'elixir_swift', name: 'Elixir of Swiftness', type: 'consumable', baseValue: 15, icon: '\u{1F32A}\uFE0F', desc: 'Sharpens the edges of a moment.', effect: { buff: { stat: 'speed', amount: 4, turns: 5 } } },
  { id: 'mana_potion', name: 'Mana Potion', type: 'consumable', baseValue: 12, icon: '\u{1F535}', desc: 'Cool, faintly humming liquid.', effect: { manaRestore: 15 } },
  { id: 'greater_mana_potion', name: 'Greater Mana Potion', type: 'consumable', baseValue: 26, icon: '\u{1F537}', desc: 'A deep well, bottled.', effect: { manaRestore: 35 } },
  // -- materials (sell only) --
  { id: 'iron_ore', name: 'Iron Ore', type: 'material', baseValue: 5, icon: '\u26CF\uFE0F', desc: 'Rough ore, worth a little to the right buyer.' },
  { id: 'wolf_pelt', name: 'Wolf Pelt', type: 'material', baseValue: 6, icon: '\u{1F43A}', desc: 'A matted pelt, still smells of the wild.' },
  { id: 'gem', name: 'Uncut Gem', type: 'material', baseValue: 20, icon: '\u{1F48E}', desc: 'Catches the light strangely.' },
  { id: 'old_coin', name: 'Old Coin', type: 'material', baseValue: 4, icon: '\u{1FA99}', desc: 'Minted by a kingdom no one remembers.' },
];

function pickRarity(bonus) {
  bonus = bonus || 0;
  const weights = RARITIES.map(r => {
    let w = r.weight;
    if (r.id === 'common') w -= bonus * 7;
    if (r.id === 'uncommon') w += bonus * 3;
    if (r.id === 'rare') w += bonus * 2.5;
    if (r.id === 'epic') w += bonus * 1.5;
    return Math.max(1, w);
  });
  return weightedPick(RARITIES, weights);
}

function generateEquipItem(baseId, tierBonus, forcedRarityId) {
  const template = baseId
    ? ITEM_TEMPLATES.find(t => t.id === baseId)
    : choice(ITEM_TEMPLATES.filter(t => t.slot));
  const rarity = forcedRarityId ? RARITIES.find(r => r.id === forcedRarityId) : pickRarity(tierBonus);
  const mods = {};
  const ranges = template.statRanges || {};
  for (const statKey of Object.keys(ranges)) {
    const [lo, hi] = ranges[statKey];
    const base = randInt(lo, hi);
    const val = Math.round(base * rarity.mult);
    if (val !== 0) mods[statKey] = val;
  }
  const name = rarity.prefix ? `${rarity.prefix} ${template.name}` : template.name;
  const value = Math.max(1, Math.round(template.baseValue * rarity.valueMult));
  return {
    uid: uid(),
    baseId: template.id,
    name,
    type: template.type,
    slot: template.slot,
    weaponType: template.weaponType || null,
    armorType: template.armorType || null,
    rarity: rarity.id,
    mods,
    effect: null,
    enchant: null,
    value,
    icon: template.icon,
    desc: template.desc,
    qty: 1,
  };
}

function generateConsumableInstance(baseId) {
  const template = ITEM_TEMPLATES.find(t => t.id === baseId);
  return {
    uid: uid(),
    baseId: template.id,
    name: template.name,
    type: template.type,
    slot: null,
    rarity: 'common',
    mods: {},
    effect: template.effect || null,
    value: template.baseValue,
    icon: template.icon,
    desc: template.desc,
    qty: 1,
  };
}

function rollLootItem(danger) {
  if (Math.random() < 0.35) return generateEquipItem(null, danger, null);
  const pool = ITEM_TEMPLATES.filter(t => t.type === 'consumable' || t.type === 'material');
  const template = choice(pool);
  return generateConsumableInstance(template.id);
}

/* ---------------------------------------------------------
   3. spells (mage only)
   --------------------------------------------------------- */
// Every spell has a scroll price now — which spells a character starts
// knowing for free is decided per-class (see CLASSES[...].startingSpells),
// not by a global flag. A class that doesn't start with a given spell can
// still learn it later from the Wizard's Tower.
const SPELLS = [
  { id: 'firebolt', name: 'Firebolt', manaCost: 6, kind: 'attack', power: [6, 11], piercing: false, desc: 'A bolt of searing flame.', scrollPrice: 40 },
  { id: 'frostlance', name: 'Frost Lance', manaCost: 10, kind: 'attack', power: [9, 15], piercing: true, desc: 'A shard of ice that punches through armor.', scrollPrice: 55 },
  { id: 'arcane_shield', name: 'Arcane Shield', manaCost: 8, kind: 'buff', buff: { stat: 'defense', amount: 6, turns: 4 }, desc: 'A shimmering ward that turns aside blows.', scrollPrice: 45 },
  { id: 'life_tap', name: 'Life Tap', manaCost: 9, kind: 'heal', heal: [10, 16], desc: 'Draws vitality from the air itself.', scrollPrice: 48 },
  { id: 'chain_lightning', name: 'Chain Lightning', manaCost: 14, kind: 'attack', power: [14, 22], piercing: false, desc: 'Arcs between you and your foe, crackling.', scrollPrice: 60 },
  { id: 'mend_wounds', name: 'Mend Wounds', manaCost: 12, kind: 'heal', heal: [18, 26], desc: 'A deeper, slower healing working.', scrollPrice: 50 },
  { id: 'stoneskin', name: 'Stoneskin', manaCost: 10, kind: 'buff', buff: { stat: 'defense', amount: 8, turns: 5 }, desc: 'Hardens flesh to something like granite.', scrollPrice: 55 },
  { id: 'haste', name: 'Haste', manaCost: 8, kind: 'buff', buff: { stat: 'speed', amount: 6, turns: 5 }, desc: 'Quickens your steps and your strikes alike.', scrollPrice: 45 },
  { id: 'meteor', name: 'Meteor', manaCost: 20, kind: 'attack', power: [20, 30], piercing: true, desc: 'Calls down a fragment of falling sky.', scrollPrice: 90 },
];

/* ---------------------------------------------------------
   4. monsters (incl. class-flavored foes) & bosses
   --------------------------------------------------------- */
const MONSTERS = [
  { id: 'rat', name: 'Giant Rat', icon: '\u{1F400}', hp: 9, attack: 3, defense: 0, speed: 4, xp: 5, gold: [2, 6], minDanger: 1, maxDanger: 2 },
  { id: 'spider', name: 'Cave Spider', icon: '\u{1F577}\uFE0F', hp: 13, attack: 5, defense: 1, speed: 7, xp: 9, gold: [3, 8], minDanger: 1, maxDanger: 3, inflicts: { debuff: 'poisoned', chance: 0.3 } },
  { id: 'wolf', name: 'Grey Wolf', icon: '\u{1F43A}', hp: 17, attack: 5, defense: 1, speed: 6, xp: 11, gold: [4, 10], minDanger: 1, maxDanger: 3, inflicts: { debuff: 'bleeding', chance: 0.3 } },
  { id: 'bandit', name: 'Bandit', icon: '\u{1F5E1}\uFE0F', hp: 22, attack: 6, defense: 2, speed: 4, xp: 15, gold: [8, 18], minDanger: 2, maxDanger: 4 },
  { id: 'boar', name: 'Wild Boar', icon: '\u{1F417}', hp: 26, attack: 7, defense: 3, speed: 2, xp: 17, gold: [5, 12], minDanger: 2, maxDanger: 3 },
  { id: 'wraith', name: 'Wraith', icon: '\u{1F47B}', hp: 32, attack: 9, defense: 3, speed: 8, xp: 28, gold: [14, 28], minDanger: 3, maxDanger: 4, inflicts: { debuff: 'weakened', chance: 0.3 } },
  { id: 'troll', name: 'Bridge Troll', icon: '\u{1F9CC}', hp: 46, attack: 11, defense: 5, speed: 2, xp: 38, gold: [20, 42], minDanger: 3, maxDanger: 4, inflicts: { debuff: 'dazed', chance: 0.3 } },
  // class-flavored foes
  { id: 'fallen_knight', name: 'Fallen Knight', icon: '\u{1F6E1}\uFE0F', hp: 30, attack: 8, defense: 6, speed: 3, xp: 22, gold: [10, 20], minDanger: 2, maxDanger: 4, inflicts: { debuff: 'fragile', chance: 0.3 } },
  { id: 'bandit_berserker', name: 'Bandit Berserker', icon: '\u{1FA93}', hp: 28, attack: 12, defense: 1, speed: 5, xp: 24, gold: [10, 22], minDanger: 2, maxDanger: 4, inflicts: { debuff: 'bleeding', chance: 0.3 } },
  { id: 'corrupted_mage', name: 'Corrupted Mage', icon: '\u{1F52E}', hp: 24, attack: 10, defense: 2, speed: 5, xp: 26, gold: [12, 24], minDanger: 3, maxDanger: 4, magicAttack: true, inflicts: { debuff: 'weakened', chance: 0.3 } },
  { id: 'shadow_assassin', name: 'Shadowblade Assassin', icon: '\u{1F977}', hp: 20, attack: 9, defense: 2, speed: 9, xp: 20, gold: [10, 20], minDanger: 2, maxDanger: 4, critChanceBonus: 0.15, inflicts: { debuff: 'poisoned', chance: 0.3 } },
  { id: 'arcane_duelist', name: 'Arcane Duelist', icon: '\u2694\uFE0F', hp: 26, attack: 9, defense: 4, speed: 6, xp: 23, gold: [11, 22], minDanger: 2, maxDanger: 4, critChanceBonus: 0.08, inflicts: { debuff: 'dazed', chance: 0.3 } },
];

function pickMonster(danger) {
  const pool = MONSTERS.filter(m => danger >= m.minDanger && danger <= m.maxDanger);
  return choice(pool.length ? pool : MONSTERS);
}

// Scales a monster's combat stats to the player's level so a fight feels
// like a fight at any point in the game. Gold and XP are deliberately left
// untouched — rewards stay tied to the monster's base tier, not the scaled
// fight, so leveling up doesn't snowball into faster leveling.
function scaleMonsterForLevel(monsterDef, level) {
  const hpMult = 1 + (level - 1) * 0.12;
  const atkMult = 1 + (level - 1) * 0.10;
  const defMult = 1 + (level - 1) * 0.05;
  return {
    ...monsterDef,
    level,
    hp: Math.max(1, Math.round(monsterDef.hp * hpMult)),
    attack: Math.max(1, Math.round(monsterDef.attack * atkMult)),
    defense: Math.max(0, Math.round(monsterDef.defense * defMult)),
  };
}

const BOSSES = {
  ashfall_wyrm: { id: 'ashfall_wyrm', name: 'The Ashfall Wyrm', icon: '\u{1F409}', hp: 170, attack: 21, defense: 9, speed: 5, xp: 150, gold: [120, 180], isBoss: true },
};

/* ---------------------------------------------------------
   5. world: towns, roads, shops
   --------------------------------------------------------- */
const LOCATIONS = {
  millhaven: {
    id: 'millhaven', name: 'Millhaven', tagline: 'A quiet crossroads town',
    description: "Smoke curls from the crooked chimneys of Millhaven. It's a modest place, but safe, and every road in the region seems to remember its way back here.",
    inn: { regular: 8, premium: 22 },
  },
  oakshade: {
    id: 'oakshade', name: 'Oakshade', tagline: 'Village of the old wood',
    description: 'Oakshade shelters beneath ancient oaks, its houses built from their fallen kin. Woodsmoke and pine sap linger in the cool air.',
    inn: { regular: 10, premium: 26 },
  },
  stonemere: {
    id: 'stonemere', name: 'Stonemere', tagline: 'Fortress of the high pass',
    description: "Grey stone walls rise against a colder sky here. Stonemere's smiths never stop hammering, and the wind never stops complaining about it.",
    inn: { regular: 12, premium: 30 },
  },
  reedport: {
    id: 'reedport', name: 'Reedport', tagline: 'The last harbor town',
    description: 'Reedport clings to the edge of a brackish sea, its docks groaning under crates of stranger and stranger cargo.',
    inn: { regular: 15, premium: 36 },
  },
  grimwatch: {
    id: 'grimwatch', name: 'Grimwatch', tagline: 'A watchful garrison town',
    description: "Grimwatch bristles with spears and suspicion. Soldiers eye every traveler twice before waving them through the gate.",
    inn: { regular: 14, premium: 32 },
  },
  duskhollow: {
    id: 'duskhollow', name: 'Duskhollow', tagline: 'Where the light gives out',
    description: "Duskhollow crouches at the edge of somewhere older than the kingdom's maps admit. Lanterns burn all day here, and still it isn't quite enough.",
    inn: { regular: 16, premium: 38 },
    wizardTower: true,
  },
  emberfall: {
    id: 'emberfall', name: 'Emberfall', tagline: 'The last true city',
    description: "Emberfall sprawls behind walls thick enough to have opinions. This is the end of the road \u2014 or the beginning of something worse, if you go looking for it.",
    inn: { regular: 20, premium: 46 },
    wizardTower: true,
    isFinalTown: true,
  },
};

// [from, to, roadName, danger(1-4), steps, description]
const EDGES = [
  ['millhaven', 'oakshade', 'Forest Trail', 1, 2, 'A mossy footpath winds beneath old oaks, dappled with fading light.'],
  ['millhaven', 'stonemere', 'Mountain Pass', 2, 3, 'A steep switchback climbs into cold, thin air and loose scree.'],
  ['oakshade', 'reedport', 'River Road', 2, 2, 'The road hugs a slow brown river, reeds hissing in the wind.'],
  ['oakshade', 'stonemere', 'Old Quarry Road', 3, 3, 'Broken cart-tracks thread through an abandoned, echoing quarry.'],
  ['stonemere', 'reedport', 'Ashen Pass', 3, 3, 'Grey ash drifts over a scorched ridge where nothing sings.'],
  ['stonemere', 'grimwatch', 'Ironback Road', 3, 3, 'A well-patrolled road, though the patrols look nervous.'],
  ['reedport', 'grimwatch', 'Silt Causeway', 3, 3, 'A narrow causeway across the tidal flats, passable only at low water.'],
  ['grimwatch', 'duskhollow', "Widow's Walk", 4, 3, 'Gallows-posts line this road, old enough that ivy has claimed them.'],
  ['duskhollow', 'emberfall', "King's Highway", 4, 4, 'A broad paved road, the first real stonework you have seen in days \u2014 the capital must be close.'],
];

// side-roads: dangerous alternatives to the normal roads above. Faded and
// overgrown, their length is re-rolled (minSteps..maxSteps) every time
// they're attempted, and they carry tougher enemies for better risk/reward.
// [from, to, roadName, danger, minSteps, maxSteps, description]
const SIDE_ROADS = [
  ['oakshade', 'reedport', 'The Drowned Path', 4, 5, 10,
    "\u{1F480} The safe road hugs the river; this one wades straight through it. The water is thick with things that used to walk, and the path forward is never quite the same length twice."],
  ['stonemere', 'grimwatch', 'Bloodrock Ridge', 4, 5, 10,
    "\u{1F480} A knife-edge trail above the tree line, stained red with old iron \u2014 or something less mineral. Exposed, unstable, and exactly the kind of place something bigger comes looking for a meal."],
  ['grimwatch', 'grimwatch', 'The Bonefields', 4, 5, 10,
    "\u{1F480} A field the garrison quietly stopped patrolling. The ground is uneven in a way that isn't entirely natural, and no two trips across it take the same number of steps."],
  ['reedport', 'duskhollow', 'Forsaken Marsh', 4, 5, 10,
    "\u{1F480} A sucking bog that swallows the direct route between the coast and the dark of Duskhollow whole. Locals say it hoards old bones and older gold in equal measure \u2014 and that it never lets you through the same way twice."],
];

const SHOP_DEFS = {
  millhaven: [
    { kind: 'consumable', baseId: 'potion', price: 8, infinite: true },
    { kind: 'consumable', baseId: 'elixir_might', price: 16, infinite: true },
    { kind: 'equip', baseId: 'shortsword', rarity: 'common' },
    { kind: 'equip', baseId: 'hatchet', rarity: 'common' },
    { kind: 'equip', baseId: 'apprentice_staff', rarity: 'common' },
    { kind: 'equip', baseId: 'switchblade', rarity: 'common' },
    { kind: 'equip', baseId: 'spellblade', rarity: 'common' },
    { kind: 'equip', baseId: 'leather_armor', rarity: 'common' },
    { kind: 'equip', baseId: 'ring', rarity: 'common' },
  ],
  oakshade: [
    { kind: 'consumable', baseId: 'potion', price: 8, infinite: true },
    { kind: 'consumable', baseId: 'elixir_might', price: 16, infinite: true },
    { kind: 'equip', baseId: 'longsword', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'battleaxe', rarity: 'common' },
    { kind: 'equip', baseId: 'twin_fang', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'leather_armor', rarity: 'uncommon' },
  ],
  stonemere: [
    { kind: 'consumable', baseId: 'greater_potion', price: 18, infinite: true },
    { kind: 'consumable', baseId: 'elixir_guard', price: 16, infinite: true },
    { kind: 'equip', baseId: 'chain_armor', rarity: 'common' },
    { kind: 'equip', baseId: 'plate_armor', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'broadsword', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'battlemage_edge', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'amulet', rarity: 'common' },
  ],
  reedport: [
    { kind: 'consumable', baseId: 'greater_potion', price: 18, infinite: true },
    { kind: 'consumable', baseId: 'elixir_swift', price: 16, infinite: true },
    { kind: 'equip', baseId: 'rapier', rarity: 'rare' },
    { kind: 'equip', baseId: 'tomahawk', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'stiletto', rarity: 'rare' },
    { kind: 'equip', baseId: 'ring', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'amulet', rarity: 'rare' },
  ],
  grimwatch: [
    { kind: 'consumable', baseId: 'greater_potion', price: 18, infinite: true },
    { kind: 'consumable', baseId: 'elixir_guard', price: 16, infinite: true },
    { kind: 'equip', baseId: 'longsword', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'chain_armor', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'battleaxe', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'warded_blade', rarity: 'uncommon' },
  ],
  duskhollow: [
    { kind: 'consumable', baseId: 'mana_potion', price: 14, infinite: true },
    { kind: 'consumable', baseId: 'elixir_swift', price: 16, infinite: true },
    { kind: 'equip', baseId: 'runed_staff', rarity: 'rare' },
    { kind: 'equip', baseId: 'runeblade', rarity: 'rare' },
    { kind: 'equip', baseId: 'mage_robes', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'shadow_garb', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'amulet', rarity: 'uncommon' },
  ],
  emberfall: [
    { kind: 'consumable', baseId: 'greater_mana_potion', price: 30, infinite: true },
    { kind: 'consumable', baseId: 'greater_potion', price: 18, infinite: true },
    { kind: 'equip', baseId: 'archstaff', rarity: 'epic' },
    { kind: 'equip', baseId: 'greataxe', rarity: 'rare' },
    { kind: 'equip', baseId: 'broadsword', rarity: 'rare' },
    { kind: 'equip', baseId: 'serrated_kris', rarity: 'epic' },
    { kind: 'equip', baseId: 'battlemage_edge', rarity: 'epic' },
    { kind: 'equip', baseId: 'plate_armor', rarity: 'rare' },
    { kind: 'equip', baseId: 'pelt_armor', rarity: 'uncommon' },
    { kind: 'equip', baseId: 'ring', rarity: 'rare' },
  ],
};

const FLAVOR_LINES = [
  'The road is quiet save for your own footsteps.',
  'A crow watches you pass, entirely unbothered.',
  'Wind stirs the dust ahead. Nothing comes of it.',
  'You pause to catch your breath. All is still.',
  'Somewhere far off, a bell tolls the hour.',
  'You pass the remains of an old campfire, long cold.',
  'The path is easy here, and your mind wanders.',
];
function pickFlavorLine() { return choice(FLAVOR_LINES); }

function buildShopStock(locId) {
  return SHOP_DEFS[locId].map(def => {
    if (def.kind === 'consumable') {
      const item = generateConsumableInstance(def.baseId);
      return { item, price: def.price, infinite: !!def.infinite, sold: false };
    }
    const item = generateEquipItem(def.baseId, 0, def.rarity);
    const price = Math.round(item.value * 1.15);
    return { item, price, infinite: false, sold: false };
  });
}

function buildWorld() {
  for (const id of Object.keys(LOCATIONS)) LOCATIONS[id].connections = [];
  for (const [a, b, name, danger, steps, desc] of EDGES) {
    LOCATIONS[a].connections.push({ to: b, name, danger, steps, desc, sideRoad: false });
    if (a !== b) LOCATIONS[b].connections.push({ to: a, name, danger, steps, desc, sideRoad: false });
  }
  for (const [a, b, name, danger, minSteps, maxSteps, desc] of SIDE_ROADS) {
    LOCATIONS[a].connections.push({ to: b, name, danger, minSteps, maxSteps, desc, sideRoad: true });
    if (a !== b) LOCATIONS[b].connections.push({ to: a, name, danger, minSteps, maxSteps, desc, sideRoad: true });
  }
  // scripted boss encounter, gateway to the "conqueror" ending
  LOCATIONS.emberfall.connections.push({
    to: 'emberfall',
    name: 'The Ashfall Depths',
    danger: 5,
    steps: 1,
    desc: 'A crack in the earth beneath the city walls, warm as a wound. Something vast sleeps down there \u2014 or did.',
    forcedBoss: 'ashfall_wyrm',
    endingId: 'conqueror',
    sideRoad: false,
  });
  for (const id of Object.keys(LOCATIONS)) {
    LOCATIONS[id].shopStock = buildShopStock(id);
    LOCATIONS[id].lastRestockTurn = state.turnCount;
  }
}

// Shops quietly refresh their wares (new rarities, "sold" items back on the
// shelf) after enough turns pass since the last restock. Checked once per
// shop visit rather than on every render, so browsing/buying doesn't
// re-trigger it mid-visit.
const SHOP_RESTOCK_INTERVAL = 40;
function maybeRestockShop(locId) {
  const loc = LOCATIONS[locId];
  if (!loc) return false;
  if (state.turnCount - loc.lastRestockTurn >= SHOP_RESTOCK_INTERVAL) {
    loc.shopStock = buildShopStock(locId);
    loc.lastRestockTurn = state.turnCount;
    return true;
  }
  return false;
}

/* ---------------------------------------------------------
   6. endings
   --------------------------------------------------------- */
const WEALTH_THRESHOLD = 400;
const LEVEL_THRESHOLD = 10;

const ABILITY_UNLOCK_LEVEL = 5;
const CLASS_ABILITIES = {
  warrior: {
    name: 'Second Wind',
    desc: 'The first time your HP drops critically low in a fight, you grit through it: an instant burst of HP and a brief hardening of your guard. Once per battle.',
  },
  mage: {
    name: 'Overchannel',
    desc: "Sometimes the arcane simply obeys — your spells have a chance to cost no mana at all.",
  },
  berserker: {
    name: 'Bloodlust',
    desc: "A share of the damage you deal is torn back from your foe as healing. The fight feeds you as much as you feed on it.",
  },
  rogue: {
    name: 'Double Attack',
    desc: "Strike fast enough and nobody notices the second blade. A chance to immediately follow up a normal attack with a free extra strike.",
  },
  spellsword: {
    name: 'Spellblade',
    desc: "Your blade channels what it cuts through. A chance for a normal attack to restore a bit of mana, feeding your next spell.",
  },
};

/* ---------------------------------------------------------
   Debuffs — afflictions enemies can inflict on the player.
   They last only for the fight that caused them (cleared when combat
   ends), tick down once per combat round, and never stack with
   themselves except Bleeding. Brace and Dodge are the counterplay.
   --------------------------------------------------------- */
const DEBUFFS = {
  poisoned: {
    name: 'Poisoned', icon: '\u2620\uFE0F', kind: 'dot', duration: 3, dotFactor: 0.25,
    desc: 'Venom burns through you, dealing steady damage each turn. Ignores Defense.',
  },
  bleeding: {
    name: 'Bleeding', icon: '\u{1FA78}', kind: 'dot', duration: 3, dotFactor: 0.15, maxStacks: 3,
    desc: 'A deep wound: damage each turn. Every further hit from the wounding enemy adds a stack (max 3) \u2014 unless you Dodge or Brace.',
  },
  dazed: {
    name: 'Dazed', icon: '\u{1F4AB}', kind: 'control', duration: 2, speedPenalty: 3, missChance: 0.2,
    desc: '-3 Speed, and your weapon attacks have a 20% chance to miss. Spells are unaffected.',
  },
  fragile: {
    name: 'Fragile', icon: '\u{1F494}', kind: 'stat', duration: 3, defenseMult: 0.75,
    desc: '-25% Defense, and Brace does nothing while it lasts.',
  },
  weakened: {
    name: 'Weakened', icon: '\u{1F53B}', kind: 'stat', duration: 3, damageDealtMult: 0.8,
    desc: 'All damage you deal is reduced by 20%, spells included.',
  },
};
const MAX_ACTIVE_DEBUFFS = 2;        // a third, different affliction simply fails to land
const DEBUFF_BRACE_CHANCE_MULT = 0.5; // bracing halves the chance a new one lands that round

function getDebuff(id) {
  const p = state.player;
  return p && p.debuffs ? p.debuffs.find(d => d.id === id) : null;
}
function hasDebuff(id) { return !!getDebuff(id); }
function clearDebuffs() { if (state.player) state.player.debuffs = []; }

// Weakened trims every point of damage the player deals (attacks AND spells).
function scaleOutgoing(result) {
  if (hasDebuff('weakened')) {
    result.dmg = Math.max(1, Math.round(result.dmg * DEBUFFS.weakened.damageDealtMult));
  }
  return result;
}
// Dazed only disrupts weapon attacks; spells never roll this.
function rollDazedMiss() {
  return hasDebuff('dazed') && Math.random() < DEBUFFS.dazed.missChance;
}

function applyDebuff(id, source, c) {
  const p = state.player;
  const def = DEBUFFS[id];
  if (!def) return false;
  if (!p.debuffs) p.debuffs = [];
  // damage-over-time scales with the source monster's (level-scaled) attack
  const power = def.kind === 'dot' ? Math.max(2, Math.round(source.attack * def.dotFactor)) : 0;
  const existing = p.debuffs.find(d => d.id === id);
  if (existing) {
    existing.turnsLeft = Math.max(existing.turnsLeft, def.duration);
    existing.power = Math.max(existing.power, power);
    if (def.maxStacks && existing.stacks < def.maxStacks) {
      existing.stacks += 1;
      c.log.push(`${def.icon} ${def.name} worsens! (\u00D7${existing.stacks})`);
    } else {
      c.log.push(`${def.icon} ${def.name} is renewed.`);
    }
    return true;
  }
  if (p.debuffs.length >= MAX_ACTIVE_DEBUFFS) return false;
  p.debuffs.push({ id, turnsLeft: def.duration, stacks: 1, power });
  c.log.push(`${def.icon} The ${source.name} inflicts ${def.name}!`);
  return true;
}

// Called after an enemy hit actually lands (a successful Dodge never gets here).
function maybeInflictDebuff(c, braced) {
  const inf = c.monster.inflicts;
  if (!inf || !DEBUFFS[inf.debuff]) return;
  const def = DEBUFFS[inf.debuff];
  // A stacking wound (Bleeding) deepens automatically with each further hit,
  // unless you braced. That's the counterplay: Dodge or Brace and it stops growing.
  if (def.maxStacks && getDebuff(inf.debuff)) {
    if (!braced) applyDebuff(inf.debuff, c.monster, c);
    return;
  }
  const chance = inf.chance * (braced ? DEBUFF_BRACE_CHANCE_MULT : 1);
  if (Math.random() < chance) applyDebuff(inf.debuff, c.monster, c);
}

// End-of-round: damage-over-time hurts (ignoring Defense), then every
// affliction loses a turn and the spent ones wear off.
function tickDebuffs(c) {
  const p = state.player;
  if (!p.debuffs || !p.debuffs.length) return;
  let total = 0;
  for (const d of p.debuffs) {
    const def = DEBUFFS[d.id];
    if (def.kind === 'dot') {
      const dmg = d.power * (d.stacks || 1);
      total += dmg;
      c.log.push(`${def.icon} ${def.name}: you take ${dmg} damage.`);
    }
    d.turnsLeft -= 1;
  }
  const expired = p.debuffs.filter(d => d.turnsLeft <= 0);
  p.debuffs = p.debuffs.filter(d => d.turnsLeft > 0);
  expired.forEach(d => c.log.push(`${DEBUFFS[d.id].name} wears off.`));
  p.hp -= total;
}

// Brace's relief: every active affliction loses extra turns right now.
function shortenDebuffs(c, amount) {
  const p = state.player;
  if (!p.debuffs || !p.debuffs.length) return false;
  for (const d of p.debuffs) d.turnsLeft -= amount;
  const cleared = p.debuffs.filter(d => d.turnsLeft <= 0);
  p.debuffs = p.debuffs.filter(d => d.turnsLeft > 0);
  cleared.forEach(d => c.log.push(`${DEBUFFS[d.id].name} fades as you steady yourself.`));
  return true;
}

function debuffChipsHtml() {
  const ds = (state.player && state.player.debuffs) || [];
  return ds.map(d => {
    const def = DEBUFFS[d.id];
    const stack = d.stacks > 1 ? ` \u00D7${d.stacks}` : '';
    return `<span class="debuff-chip" title="${def.desc}">${def.icon} ${def.name}${stack} <span class="debuff-turns">${d.turnsLeft}t</span></span>`;
  }).join('');
}

// Warrior's Second Wind, shared so that ANY damage to the player (a hit or a
// damage-over-time tick) can trigger it before the death check.
function checkSecondWind(c) {
  const p = state.player;
  const stats = computeStats(p);
  if (p.classId === 'warrior' && p.level >= ABILITY_UNLOCK_LEVEL && !c.secondWindUsed && p.hp <= Math.round(stats.maxHp * 0.3)) {
    c.secondWindUsed = true;
    const healAmt = Math.round(stats.maxHp * 0.3);
    p.hp = Math.min(stats.maxHp, Math.max(1, p.hp) + healAmt);
    addBuff(p, { stat: 'defense', amount: 6, turns: 3 });
    c.log.push(`\u2694\uFE0F Second Wind! You grit through the pain, recovering ${healAmt} HP and hardening your guard.`);
  }
}

const ENDINGS = {
  traveler: {
    title: 'The Long Road Home', tagline: "Journey's End",
    text: "You stand at the far edge of the map, Emberfall's spires behind you and open country ahead. Some journeys are their own reward. You set down your pack, and rest.",
  },
  conqueror: {
    title: 'Slayer of the Ashfall Wyrm', tagline: 'A Legend Is Born',
    text: "The wyrm's final breath scorches the stones black. Word of this day will outlive you. Bards will get the details wrong, and you'll let them.",
  },
  merchant: {
    title: "The Merchant's Retirement", tagline: 'Coin Enough For Ten Lifetimes',
    text: "You count your gold one final time, then stop counting. There's a modest house waiting in Millhaven with your name on the deed, bought and paid for.",
  },
  legend: {
    title: 'A Legend Among Wanderers', tagline: 'None Left to Best You',
    text: "Innkeepers stop charging you for rooms. Children reenact your battles with sticks. You've become something between a rumor and a monument.",
  },
};

/* ---------------------------------------------------------
   7. player & stat math
   --------------------------------------------------------- */
function createPlayer(classId) {
  const c = CLASSES[classId];
  return {
    name: 'The Wanderer',
    classId,
    level: 1,
    xp: 0,
    xpNext: 20,
    gold: 50,
    hp: c.baseMaxHp,
    mana: c.baseMaxMana,
    baseMaxHp: c.baseMaxHp,
    baseAttack: c.baseAttack,
    baseDefense: c.baseDefense,
    baseSpeed: c.baseSpeed,
    baseMaxMana: c.baseMaxMana,
    baseCritChance: c.baseCritChance,
    baseCritDamage: c.baseCritDamage,
    location: 'millhaven',
    equipment: { weapon: null, armor: null, trinket: null },
    inventory: [],
    buffs: [],
    debuffs: [],
    knownSpells: Array.isArray(c.startingSpells) ? c.startingSpells.slice() : [],
  };
}

function computeStats(p) {
  let attack = p.baseAttack, defense = p.baseDefense, speed = p.baseSpeed, maxHp = p.baseMaxHp, maxMana = p.baseMaxMana;
  let critChance = typeof p.baseCritChance === 'number' ? p.baseCritChance : BASE_CRIT_CHANCE;
  let critDamage = typeof p.baseCritDamage === 'number' ? p.baseCritDamage : BASE_CRIT_DAMAGE;
  for (const slot of ['weapon', 'armor', 'trinket']) {
    const it = p.equipment[slot];
    if (!it) continue;
    attack += it.mods.attack || 0;
    defense += it.mods.defense || 0;
    speed += it.mods.speed || 0;
    maxHp += it.mods.maxHp || 0;
    maxMana += it.mods.maxMana || 0;
    critChance += it.mods.critChance || 0;
    critDamage += it.mods.critDamage || 0;
  }
  for (const b of p.buffs) {
    if (b.stat === 'attack') attack += b.amount;
    if (b.stat === 'defense') defense += b.amount;
    if (b.stat === 'speed') speed += b.amount;
    if (b.stat === 'maxHp') maxHp += b.amount;
    if (b.stat === 'critChance') critChance += b.amount;
    if (b.stat === 'critDamage') critDamage += b.amount;
  }
  const activeDebuffs = p.debuffs || [];
  if (activeDebuffs.some(d => d.id === 'dazed')) speed -= DEBUFFS.dazed.speedPenalty;
  if (activeDebuffs.some(d => d.id === 'fragile')) defense = Math.round(Math.max(0, defense) * DEBUFFS.fragile.defenseMult);
  return {
    attack: Math.max(0, attack),
    defense: Math.max(0, defense),
    speed: Math.max(1, speed),
    maxHp: Math.max(1, maxHp),
    maxMana: Math.max(0, maxMana),
    critChance: clamp(critChance, 0, 0.95),
    critDamage: Math.max(1, critDamage),
  };
}

function clampVitals() {
  const p = state.player;
  const stats = computeStats(p);
  if (p.hp > stats.maxHp) p.hp = stats.maxHp;
  if (p.mana > stats.maxMana) p.mana = stats.maxMana;
}

function canEquip(item) {
  if (!item.slot) return true;
  if (item.slot === 'trinket') return true;
  const classDef = CLASSES[state.player.classId];
  if (item.slot === 'weapon') return classDef.weaponTypes.includes(item.weaponType);
  if (item.slot === 'armor') return classDef.armorTypes.includes(item.armorType);
  return true;
}

function addToInventory(p, item) {
  if (item.type === 'consumable' || item.type === 'material') {
    const existing = p.inventory.find(it => it.baseId === item.baseId && it.type === item.type);
    if (existing) { existing.qty += (item.qty || 1); return; }
  }
  p.inventory.push(item);
}

function removeOneFromInventory(p, itemUid) {
  const idx = p.inventory.findIndex(it => it.uid === itemUid);
  if (idx === -1) return;
  const item = p.inventory[idx];
  if (item.qty && item.qty > 1) item.qty -= 1;
  else p.inventory.splice(idx, 1);
}

function labelForStat(stat) {
  return { attack: 'Attack', defense: 'Defense', speed: 'Speed', maxHp: 'Max HP', maxMana: 'Max Mana', critChance: 'Crit Chance', critDamage: 'Crit Damage' }[stat] || stat;
}

function effectToText(effect) {
  if (!effect) return '';
  if (effect.heal) return `Restores ${effect.heal} HP`;
  if (effect.manaRestore) return `Restores ${effect.manaRestore} mana`;
  if (effect.buff) return `+${effect.buff.amount} ${labelForStat(effect.buff.stat)} for ${effect.buff.turns} turns`;
  return '';
}

function addBuff(p, def) {
  const existing = p.buffs.find(b => b.stat === def.stat);
  if (existing) {
    existing.amount = Math.max(existing.amount, def.amount);
    existing.turnsLeft = Math.max(existing.turnsLeft, def.turns);
    existing.label = `+${existing.amount} ${labelForStat(def.stat)}`;
  } else {
    p.buffs.push({ id: uid(), stat: def.stat, amount: def.amount, turnsLeft: def.turns, label: `+${def.amount} ${labelForStat(def.stat)}` });
  }
  clampVitals();
}

function tickTurn() {
  state.turnCount++;
  const p = state.player;
  const remaining = [];
  for (const b of p.buffs) {
    b.turnsLeft -= 1;
    if (b.turnsLeft > 0) remaining.push(b);
    else log(`Your ${labelForStat(b.stat)} boost fades.`, null);
  }
  p.buffs = remaining;
  const regenStats = computeStats(p);
  if (regenStats.maxMana > 0) {
    p.mana = Math.min(regenStats.maxMana, p.mana + 2);
  }
  clampVitals();
}

function applyConsumable(item) {
  const p = state.player;
  if (item.effect && item.effect.heal) {
    const stats = computeStats(p);
    const before = p.hp;
    p.hp = Math.min(stats.maxHp, p.hp + item.effect.heal);
    log(`You recover ${p.hp - before} HP.`, 'good');
  }
  if (item.effect && item.effect.manaRestore) {
    const stats = computeStats(p);
    const before = p.mana;
    p.mana = Math.min(stats.maxMana, p.mana + item.effect.manaRestore);
    log(`You recover ${p.mana - before} mana.`, 'good');
  }
  if (item.effect && item.effect.buff) {
    addBuff(p, item.effect.buff);
    log(`You feel a surge of ${labelForStat(item.effect.buff.stat)}.`, 'good');
  }
}

function gainXp(amount) {
  const p = state.player;
  p.xp += amount;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level += 1;
    p.xpNext = Math.round(p.xpNext * 1.45 + 14);
    p.baseMaxHp += 8;
    p.baseAttack += 2;
    p.baseDefense += 1;
    p.baseSpeed += 1;
    p.baseMaxMana += (CLASSES[p.classId] && CLASSES[p.classId].manaPerLevel) || 0;
    const stats = computeStats(p);
    p.hp = stats.maxHp;
    p.mana = stats.maxMana;
    log(`You reach Level ${p.level}! Your strength grows.`, 'good');
  }
}

/* ---------------------------------------------------------
   8. journal / logging
   --------------------------------------------------------- */
function log(text, cls) {
  state.log.push({ text, cls: cls || null });
  if (state.log.length > 60) state.log.shift();
}

/* ---------------------------------------------------------
   9. global game state
   --------------------------------------------------------- */
const state = {
  player: null,
  screen: 'class-select',  // class-select | town | shop | inn | wizard | wizard-enchant | wizard-spells | travel-choice | traveling | combat | gameover | ending
  travelState: null,       // { conn, stepsRemaining, totalSteps }
  combatState: null,       // { monster, danger, returnTo, log, victory, showItems, showSpells, pendingEnding }
  endingId: null,
  log: [],
  turnCount: 0,
  exportFolderName: null,   // name of the remembered export folder (File System Access), if any
  settings: null,          // populated from storage in initGame(); see loadSettingsFromStorage()
};

/* ---------------------------------------------------------
   9b. persistence — save/continue/import/export/settings
   --------------------------------------------------------- */
const SAVE_KEY = 'ashfall_road_save_v1';
const SETTINGS_KEY = 'ashfall_road_settings_v1';
const SAVE_VERSION = 1;
const GAME_VERSION = '1.5.1';
const DEFAULT_SETTINGS = { reduceMotion: false, largerText: false, autosave: true, showRestockTimer: false };

function storageAvailable() {
  try {
    const k = '__ashfall_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (err) {
    return false;
  }
}

function hasSaveData() {
  if (!storageAvailable()) return false;
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch (err) {
    return false;
  }
}

function buildSaveObject() {
  if (!state.player) return null;
  const shopStock = {};
  for (const id of Object.keys(LOCATIONS)) {
    shopStock[id] = { stock: LOCATIONS[id].shopStock, lastRestockTurn: LOCATIONS[id].lastRestockTurn };
  }
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    turnCount: state.turnCount,
    player: state.player,
    shopStock,
  };
}

function saveGameToStorage() {
  const data = buildSaveObject();
  if (!data || !storageAvailable()) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Ashfall Road: failed to save game:', err);
  }
}

function loadSaveFromStorage() {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Ashfall Road: failed to read save:', err);
    return null;
  }
}

function deleteSaveData() {
  if (!storageAvailable()) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* ignore */ }
}

function sanitizePlayer(raw) {
  const classDef = CLASSES[raw.classId];
  if (!classDef) throw new Error('Unknown class in save data: ' + raw.classId);
  return {
    name: raw.name || 'The Wanderer',
    classId: raw.classId,
    level: typeof raw.level === 'number' ? raw.level : 1,
    xp: typeof raw.xp === 'number' ? raw.xp : 0,
    xpNext: typeof raw.xpNext === 'number' ? raw.xpNext : 20,
    gold: typeof raw.gold === 'number' ? raw.gold : 0,
    hp: typeof raw.hp === 'number' ? raw.hp : classDef.baseMaxHp,
    mana: typeof raw.mana === 'number' ? raw.mana : classDef.baseMaxMana,
    baseMaxHp: typeof raw.baseMaxHp === 'number' ? raw.baseMaxHp : classDef.baseMaxHp,
    baseAttack: typeof raw.baseAttack === 'number' ? raw.baseAttack : classDef.baseAttack,
    baseDefense: typeof raw.baseDefense === 'number' ? raw.baseDefense : classDef.baseDefense,
    baseSpeed: typeof raw.baseSpeed === 'number' ? raw.baseSpeed : classDef.baseSpeed,
    baseMaxMana: typeof raw.baseMaxMana === 'number' ? raw.baseMaxMana : classDef.baseMaxMana,
    baseCritChance: typeof raw.baseCritChance === 'number' ? raw.baseCritChance : classDef.baseCritChance,
    baseCritDamage: typeof raw.baseCritDamage === 'number' ? raw.baseCritDamage : classDef.baseCritDamage,
    location: (raw.location && LOCATIONS[raw.location]) ? raw.location : 'millhaven',
    equipment: raw.equipment && typeof raw.equipment === 'object'
      ? { weapon: raw.equipment.weapon || null, armor: raw.equipment.armor || null, trinket: raw.equipment.trinket || null }
      : { weapon: null, armor: null, trinket: null },
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    buffs: [], // transient combat effects never carry across a save/load
    debuffs: [],
    knownSpells: Array.isArray(raw.knownSpells)
      ? raw.knownSpells
      : (Array.isArray(classDef.startingSpells) ? classDef.startingSpells.slice() : []),
  };
}

// Item uids come from a counter that restarts at 1 on every page load, but
// saved items keep the uids they were given in earlier sessions. Without
// this, a newly found item can reuse a saved item's uid, and every
// uid-based lookup (equip, sell, use, enchant) then grabs the wrong item.
// This resyncs the counter past every uid in use, and gives any item that
// is already duplicated a fresh uid (which also repairs older saves).
function repairItemUids() {
  const p = state.player;
  if (!p) return;
  const items = [];
  for (const slot of ['weapon', 'armor', 'trinket']) if (p.equipment[slot]) items.push(p.equipment[slot]);
  items.push(...p.inventory);
  for (const id of Object.keys(LOCATIONS)) {
    for (const entry of (LOCATIONS[id].shopStock || [])) if (entry && entry.item) items.push(entry.item);
  }
  let max = 0;
  for (const it of items) {
    const n = parseInt(String(it.uid).replace(/^itm/, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  if (_uidCounter <= max) _uidCounter = max + 1;
  const seen = new Set();
  for (const it of items) {
    if (!it.uid || seen.has(it.uid)) it.uid = uid();
    seen.add(it.uid);
  }
}

// Shared by both "Continue Your Adventure" (localStorage) and "Import Save"
// (a chosen file) — always lands the player safely in town, never mid-combat
// or mid-travel, since neither of those is serialized.
function loadSaveObject(data) {
  if (!data || typeof data !== 'object' || !data.player) throw new Error('Not a valid save file');
  state.turnCount = typeof data.turnCount === 'number' ? data.turnCount : 0;
  buildWorld(); // seeds every location's shopStock + lastRestockTurn against the restored turnCount
  state.player = sanitizePlayer(data.player);
  if (data.shopStock && typeof data.shopStock === 'object') {
    for (const locId of Object.keys(data.shopStock)) {
      const entry = data.shopStock[locId];
      if (!LOCATIONS[locId] || !entry) continue;
      if (Array.isArray(entry)) {
        // backward-compat: older saves stored the stock array directly
        LOCATIONS[locId].shopStock = entry;
        LOCATIONS[locId].lastRestockTurn = state.turnCount;
      } else if (Array.isArray(entry.stock)) {
        LOCATIONS[locId].shopStock = entry.stock;
        LOCATIONS[locId].lastRestockTurn = typeof entry.lastRestockTurn === 'number' ? entry.lastRestockTurn : state.turnCount;
      }
    }
  }
  repairItemUids();
  state.log = [];
  state.travelState = null;
  state.combatState = null;
  state.endingId = null;
  state.screen = 'town';

  const stats = computeStats(state.player);
  if (state.player.hp <= 0) state.player.hp = Math.max(1, Math.floor(stats.maxHp * 0.5));
  state.player.hp = Math.min(state.player.hp, stats.maxHp);
  state.player.mana = Math.min(Math.max(0, state.player.mana), stats.maxMana);

  log(`Welcome back. Your journey as a ${CLASSES[state.player.classId].name} continues.`, null);
  saveGameToStorage();
  renderAll();
}

function continueAdventure() {
  const data = loadSaveFromStorage();
  if (!data) return;
  try {
    loadSaveObject(data);
  } catch (err) {
    console.error('Ashfall Road: failed to load save:', err);
    alert('Your saved adventure could not be loaded — the save data may be corrupted.');
  }
}

function triggerImport() {
  const input = document.getElementById('import-file-input');
  if (input) input.click();
}

function handleImportFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (state.player) {
    const proceed = confirm('Importing will replace your current adventure. Continue?');
    if (!proceed) return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      loadSaveObject(data);
      log('Save imported successfully.', 'good');
      renderAll();
      closeSettings();
    } catch (err) {
      console.error('Ashfall Road: import failed:', err);
      alert("That doesn't look like a valid Ashfall Road save file.");
    }
  };
  reader.onerror = () => alert('Could not read that file.');
  reader.readAsText(file);
}

/* ---------------------------------------------------------
   Export to a SAVES folder (Chrome / Edge: File System Access API).
   The first export asks you to pick the Ashfall Road folder; a SAVES
   folder is created inside it and every export is written there as a
   timestamped file. The chosen folder is remembered in IndexedDB.
   Anywhere the API is missing, or if anything fails, it falls back to
   an ordinary browser download.
   --------------------------------------------------------- */
const FS_DB_NAME = 'ashfall_road_fs';
const FS_STORE = 'handles';
const FS_KEY = 'exportRoot';
const SAVES_DIR_NAME = 'SAVES';

function fsAccessSupported() { return typeof showDirectoryPicker === 'function'; }

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(FS_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FS_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction(FS_STORE).objectStore(FS_STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction(FS_STORE, 'readwrite').objectStore(FS_STORE).put(value, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
async function idbDelete(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction(FS_STORE, 'readwrite').objectStore(FS_STORE).delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// Returns a directory handle we're allowed to write to: the remembered one
// (re-confirming permission if the browser dropped it), or a fresh pick.
async function getExportRootHandle(forcePick) {
  let handle = null;
  if (!forcePick) {
    try { handle = await idbGet(FS_KEY); } catch (e) { handle = null; }
    if (handle) {
      try {
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') handle = null;
      } catch (e) { handle = null; }
    }
  }
  if (!handle) {
    handle = await showDirectoryPicker({ id: 'ashfall-road', mode: 'readwrite' });
    try { await idbSet(FS_KEY, handle); } catch (e) { /* still usable this session */ }
  }
  state.exportFolderName = handle.name;
  return handle;
}

async function getSavesDir(root) {
  if (root.name === SAVES_DIR_NAME) return root; // they picked SAVES itself
  return root.getDirectoryHandle(SAVES_DIR_NAME, { create: true });
}
function savesDisplayPath(root) {
  return root.name === SAVES_DIR_NAME ? SAVES_DIR_NAME : `${root.name}/${SAVES_DIR_NAME}`;
}

// Never overwrite an earlier export: add _2, _3... if the name is taken.
async function uniqueFileName(dir, base) {
  let name = `${base}.json`;
  for (let n = 2; n < 1000; n++) {
    try {
      await dir.getFileHandle(name);
    } catch (e) {
      if (e && e.name === 'NotFoundError') return name;
      throw e;
    }
    name = `${base}_${n}.json`;
  }
  return `${base}_${Date.now()}.json`;
}

function exportTimestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function downloadSaveFile(filename, json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function rerenderSettingsIfOpen() {
  const m = document.getElementById('settings-modal');
  if (m && m.classList.contains('open')) renderSettingsContent();
}

async function exportSave() {
  const data = buildSaveObject();
  if (!data) return;
  const json = JSON.stringify(data, null, 2);
  const base = `ashfall-road-${state.player.classId}-lvl${state.player.level}-${exportTimestamp()}`;

  if (fsAccessSupported()) {
    try {
      const root = await getExportRootHandle(false);
      const dir = await getSavesDir(root);
      const filename = await uniqueFileName(dir, base);
      const fileHandle = await dir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      log(`Save exported to ${savesDisplayPath(root)}/${filename}`, 'good');
    } catch (err) {
      if (err && err.name === 'AbortError') {
        log('Export cancelled.', null);
      } else {
        console.error('Ashfall Road: export to the SAVES folder failed, downloading instead:', err);
        // a moved/deleted folder or revoked permission means the remembered handle is dead
        if (err && ['NotFoundError', 'NotAllowedError', 'SecurityError'].includes(err.name)) {
          try { await idbDelete(FS_KEY); } catch (e) { /* ignore */ }
          state.exportFolderName = null;
        }
        downloadSaveFile(`${base}.json`, json);
        log('Could not write to the SAVES folder, so the save was downloaded instead. You may be asked to choose the folder again next time.', 'bad');
      }
    }
    renderAll();
    rerenderSettingsIfOpen();
    return;
  }

  downloadSaveFile(`${base}.json`, json);
  log('Save exported to a file.', 'good');
  renderAll();
}

async function changeExportFolder() {
  if (!fsAccessSupported()) return;
  try {
    const root = await getExportRootHandle(true);
    log(`Export folder set. Saves will go to ${savesDisplayPath(root)}.`, 'good');
  } catch (err) {
    if (!(err && err.name === 'AbortError')) {
      console.error('Ashfall Road: could not set the export folder:', err);
      log('Could not set the export folder.', 'bad');
    }
  }
  renderAll();
  rerenderSettingsIfOpen();
}

// Reads the remembered folder's name (no permission needed) for the settings label.
async function refreshExportFolderLabel() {
  if (!fsAccessSupported()) return;
  try {
    const h = await idbGet(FS_KEY);
    const name = h ? h.name : null;
    if (name !== state.exportFolderName) {
      state.exportFolderName = name;
      rerenderSettingsIfOpen();
    }
  } catch (e) { /* no stored folder */ }
}

function exportFolderHtml() {
  if (!fsAccessSupported()) {
    return `<p class="settings-hint">Exports download to your browser's normal Downloads folder. (Saving straight into a SAVES folder needs Chrome or Edge.)</p>`;
  }
  const where = state.exportFolderName
    ? `Exporting to <strong>${escHtml(state.exportFolderName === SAVES_DIR_NAME ? SAVES_DIR_NAME : state.exportFolderName + '/' + SAVES_DIR_NAME)}</strong>`
    : 'On your first export, pick your Ashfall Road folder \u2014 a SAVES folder will be created inside it.';
  return `<p class="settings-hint">${where}</p>
    <div class="action-row"><button class="ghost-btn" data-action="change-export-folder">Change Export Folder</button></div>`;
}

function manualSave() {
  saveGameToStorage();
  log('Game saved.', 'good');
  renderAll();
}

function returnToTitle() {
  if (state.settings && !state.settings.autosave) {
    const ok = confirm('Autosave is off, so any progress since your last save will be lost. Return to the title screen anyway?');
    if (!ok) return;
  }
  state.player = null;
  state.combatState = null;
  state.travelState = null;
  state.endingId = null;
  state.screen = 'class-select';
  closeSettings();
  renderAll();
}

function confirmDeleteSave() {
  const ok = confirm('This permanently deletes your saved adventure from this device. This cannot be undone. Continue?');
  if (!ok) return;
  deleteSaveData();
  state.player = null;
  state.combatState = null;
  state.travelState = null;
  state.endingId = null;
  state.screen = 'class-select';
  closeSettings();
  renderAll();
}

function loadSettingsFromStorage() {
  if (!storageAvailable()) return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsToStorage() {
  if (!storageAvailable()) return;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (err) { /* ignore */ }
}

function applySettings() {
  document.body.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  document.body.classList.toggle('larger-text', !!state.settings.largerText);
}

function openSettings() {
  renderSettingsContent();
  refreshExportFolderLabel();
  document.getElementById('settings-modal').classList.add('open');
  document.getElementById('modal-backdrop').classList.add('open');
}
function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
  document.getElementById('modal-backdrop').classList.remove('open');
}

function renderSettingsContent() {
  const el = document.getElementById('settings-content');
  if (!el) return;
  const s = state.settings || DEFAULT_SETTINGS;
  el.innerHTML = `
    <div class="settings-section">
      <label class="settings-toggle-row" data-action="toggle-setting" data-setting="autosave">
        <span>Autosave</span>
        <input type="checkbox" tabindex="-1" ${s.autosave ? 'checked' : ''}>
      </label>
      <label class="settings-toggle-row" data-action="toggle-setting" data-setting="reduceMotion">
        <span>Reduce UI Motion</span>
        <input type="checkbox" tabindex="-1" ${s.reduceMotion ? 'checked' : ''}>
      </label>
      <label class="settings-toggle-row" data-action="toggle-setting" data-setting="largerText">
        <span>Larger Text</span>
        <input type="checkbox" tabindex="-1" ${s.largerText ? 'checked' : ''}>
      </label>
      <label class="settings-toggle-row" data-action="toggle-setting" data-setting="showRestockTimer">
        <span>Show Shop Restock Timer</span>
        <input type="checkbox" tabindex="-1" ${s.showRestockTimer ? 'checked' : ''}>
      </label>
    </div>
    <p class="settings-hint">${s.autosave ? 'Your progress saves automatically to this device as you play.' : 'Autosave is off — use "Save Now" below to save manually.'}</p>
    <hr class="divider">
    <div class="action-row">
      <button class="seal-btn small" data-action="manual-save">\u{1F4BE} Save Now</button>
      <button class="seal-btn small steel" data-action="export-save">\u{1F4E5} Export Save</button>
      <button class="seal-btn small steel" data-action="trigger-import">\u{1F4E4} Import Save</button>
    </div>
    ${exportFolderHtml()}
    <hr class="divider">
    <div class="action-row">
      <button class="ghost-btn" data-action="return-title">Return to Title Screen</button>
      <button class="ghost-btn" style="border-color:var(--blood); color:var(--blood-light);" data-action="delete-save">Delete Save Data</button>
    </div>
    <p class="settings-version">Ashfall Road &middot; v${GAME_VERSION}</p>
  `;
}

/* ---------------------------------------------------------
   10. rendering
   --------------------------------------------------------- */
function renderAll() {
  const appEl = document.getElementById('app');
  if (appEl) appEl.classList.toggle('pre-game', state.screen === 'class-select');
  // Each panel renders independently: if one throws (e.g. a stale/mismatched
  // HTML file missing an element the script expects), it's logged and
  // skipped rather than aborting the whole render — most importantly, the
  // action box (renderScene) always gets its turn to update.
  safeRender('header', renderHeader);
  safeRender('char panel', renderCharPanel);
  safeRender('journal', renderJournal);
  safeRender('inventory drawer', renderInventoryDrawer);
  safeRender('scene', renderScene);
  if (state.player && state.settings && state.settings.autosave) {
    safeRender('autosave', saveGameToStorage);
  }
}

function safeRender(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`Ashfall Road: failed to render ${label}:`, err);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = pct + '%';
}

function renderHeader() {
  const p = state.player;
  if (!p) return;
  const stats = computeStats(p);
  const hpPct = clampPct(p.hp, stats.maxHp);
  setWidth('hp-fill', hpPct);
  setText('hp-text', `${p.hp} / ${stats.maxHp}`);
  setText('level-text', p.level);
  setText('gold-text', p.gold);
  const loc = LOCATIONS[p.location];
  setText('location-subtitle', `${loc.name} \u2014 ${loc.tagline}`);
}

function renderCharPanel() {
  const p = state.player;
  if (!p) return;
  const stats = computeStats(p);
  const classDef = CLASSES[p.classId];

  setText('char-name', classDef.name);
  setText('char-initial', classDef.icon);
  setText('char-level', p.level);

  const xpPct = clampPct(p.xp, p.xpNext);
  setWidth('char-xp-fill', xpPct);
  setText('char-xp-text', `${p.xp} / ${p.xpNext} XP`);

  const manaWrap = document.getElementById('mana-wrap');
  if (manaWrap) {
    if (stats.maxMana > 0) {
      manaWrap.style.display = '';
      const manaPct = clampPct(p.mana, stats.maxMana);
      setWidth('char-mana-fill', manaPct);
      setText('char-mana-text', `${p.mana} / ${stats.maxMana} MP`);
    } else {
      manaWrap.style.display = 'none';
    }
  }

  const ability = CLASS_ABILITIES[p.classId];
  const abilityWrap = document.getElementById('ability-wrap');
  if (abilityWrap) {
    const unlocked = p.level >= ABILITY_UNLOCK_LEVEL;
    const progress = unlocked ? 1 : clamp((p.level - 1 + p.xp / p.xpNext) / (ABILITY_UNLOCK_LEVEL - 1), 0, 1);
    setWidth('char-ability-fill', Math.round(progress * 100));
    setText('char-ability-text', unlocked
      ? `${ability.name} \u2014 Unlocked`
      : `${ability.name} \u2014 Lv ${ABILITY_UNLOCK_LEVEL} (${Math.round(progress * 100)}%)`);
    abilityWrap.classList.toggle('unlocked', unlocked);
    abilityWrap.title = `${ability.name}: ${ability.desc}${unlocked ? '' : ` Unlocks at level ${ABILITY_UNLOCK_LEVEL}.`}`;
  }

  setText('stat-atk', stats.attack);
  setText('stat-def', stats.defense);
  setText('stat-spd', stats.speed);
  setText('stat-maxhp', stats.maxHp);
  setText('stat-crit', Math.round(stats.critChance * 100) + '%');

  for (const slot of ['weapon', 'armor', 'trinket']) {
    const item = p.equipment[slot];
    const container = document.getElementById('eq-' + slot);
    if (!container) continue;
    const slotItemEl = container.querySelector('.slot-item');
    if (!slotItemEl) continue;
    if (item) {
      slotItemEl.textContent = item.name;
      slotItemEl.className = `slot-item rarity-${item.rarity}`;
    } else {
      slotItemEl.textContent = '\u2014 none \u2014';
      slotItemEl.className = 'slot-item';
    }
  }

  const buffsList = document.getElementById('buffs-list');
  if (!buffsList) return;
  const buffChips = p.buffs.map(b => `<div class="buff-chip"><span>${b.label}</span><span class="buff-turns">${b.turnsLeft}t</span></div>`);
  const debuffChips = (p.debuffs || []).map(d => {
    const def = DEBUFFS[d.id];
    const stack = d.stacks > 1 ? ` \u00D7${d.stacks}` : '';
    return `<div class="buff-chip debuff-chip-row" title="${def.desc}"><span>${def.icon} ${def.name}${stack}</span><span class="buff-turns">${d.turnsLeft}t</span></div>`;
  });
  if (!buffChips.length && !debuffChips.length) {
    buffsList.innerHTML = `<p class="empty-note">No active effects.</p>`;
  } else {
    buffsList.innerHTML = [...debuffChips, ...buffChips].join('');
  }
}

function renderJournal() {
  const el = document.getElementById('journal-log');
  el.innerHTML = state.log.map(e => `<p class="${e.cls ? ('log-' + e.cls) : ''}">${e.text}</p>`).join('');
}

function modsToHtml(mods) {
  const labels = { attack: 'ATK', defense: 'DEF', speed: 'SPD', maxHp: 'Max HP', maxMana: 'Max MP', critChance: 'Crit Chance', critDamage: 'Crit Damage' };
  const pctKeys = new Set(['critChance', 'critDamage']);
  const entries = Object.entries(mods || {});
  if (!entries.length) return `<div class="item-mods">No bonuses</div>`;
  const parts = entries.map(([k, v]) => {
    const cls = v >= 0 ? 'pos' : 'neg';
    const display = pctKeys.has(k) ? `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%` : `${v >= 0 ? '+' : ''}${v}`;
    return `<span class="${cls}">${display} ${labels[k] || k}</span>`;
  });
  return `<div class="item-mods">${parts.join('&nbsp;&nbsp;')}</div>`;
}

function invItemRow(item) {
  const nameClass = item.slot ? `rarity-${item.rarity}` : '';
  let detailHtml;
  if (item.slot) {
    detailHtml = modsToHtml(item.mods);
  } else if (item.effect) {
    detailHtml = `<div class="item-mods">${effectToText(item.effect)}</div>`;
  } else {
    detailHtml = `<div class="item-mods">Worth ${Math.max(1, Math.round(item.value * 0.5))} gold to a buyer</div>`;
  }
  let actions = '';
  if (item.slot === 'weapon' || item.slot === 'armor') {
    if (canEquip(item)) {
      actions = `<button class="small-btn buy" data-action="equip-item" data-uid="${item.uid}">Equip</button>`;
    } else {
      const classDef = CLASSES[state.player.classId];
      const need = item.slot === 'weapon' ? classDef.weaponTypes.join('/') : classDef.armorTypes.join('/');
      actions = `<button class="small-btn" disabled title="${classDef.name}s can only use: ${need}">Can't Use</button>`;
    }
  } else if (item.slot === 'trinket') {
    actions = `<button class="small-btn buy" data-action="equip-item" data-uid="${item.uid}">Equip</button>`;
  } else if (item.type === 'consumable') {
    actions = `<button class="small-btn buy" data-action="use-item" data-uid="${item.uid}">Use</button>`;
  }
  return `
    <div class="item-row">
      <span class="item-icon">${item.icon || '\u2754'}</span>
      <div class="item-main">
        <div class="item-name-row">
          <span class="item-name ${nameClass}">${item.name}</span>
          ${item.qty > 1 ? `<span class="item-qty">x${item.qty}</span>` : ''}
        </div>
        ${detailHtml}
      </div>
      <div class="item-actions">${actions}</div>
    </div>
  `;
}

function renderInventoryDrawer() {
  const el = document.getElementById('inventory-content');
  const p = state.player;
  if (!p) { el.innerHTML = ''; return; }
  const groups = [
    { label: 'Weapons, Armor & Trinkets', items: p.inventory.filter(it => it.slot) },
    { label: 'Consumables', items: p.inventory.filter(it => it.type === 'consumable') },
    { label: 'Materials', items: p.inventory.filter(it => it.type === 'material') },
  ];
  let html = '';
  for (const g of groups) {
    html += `<h3 class="section-heading">${g.label}</h3>`;
    if (!g.items.length) { html += `<p class="empty-note">Nothing here.</p>`; continue; }
    html += `<div class="item-list">${g.items.map(invItemRow).join('')}</div>`;
  }
  el.innerHTML = html;
}

function setScene(html) {
  const el = document.getElementById('scene-content');
  el.innerHTML = html;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

function renderScene() {
  switch (state.screen) {
    case 'class-select': return sceneClassSelect();
    case 'town': return sceneTown();
    case 'shop': return sceneShop();
    case 'inn': return sceneInn();
    case 'wizard': return sceneWizardHub();
    case 'wizard-enchant': return sceneWizardEnchant();
    case 'wizard-spells': return sceneWizardSpells();
    case 'travel-choice': return sceneTravelChoice();
    case 'traveling': return sceneTraveling();
    case 'combat': return sceneCombat();
    case 'gameover': return sceneGameOver();
    case 'ending': return sceneEnding();
    default: return sceneTown();
  }
}

/* ---------------------------------------------------------
   11. scene builders
   --------------------------------------------------------- */
function sceneClassSelect() {
  const cards = Object.values(CLASSES).map(c => {
    const ability = CLASS_ABILITIES[c.id];
    return `
    <div class="card class-card" data-action="select-class" data-class="${c.id}" role="button" tabindex="0">
      <div class="card-title-row"><span class="card-title">${c.icon} ${c.name}</span></div>
      <p class="card-desc"><em>${c.tagline}</em></p>
      <p class="card-desc">${c.description}</p>
      <div class="item-mods">ATK ${c.baseAttack}&nbsp;&nbsp;DEF ${c.baseDefense}&nbsp;&nbsp;SPD ${c.baseSpeed}&nbsp;&nbsp;HP ${c.baseMaxHp}${c.baseMaxMana ? `&nbsp;&nbsp;MP ${c.baseMaxMana}` : ''}</div>
      <p class="card-desc"><span class="ability-preview">\u2726 ${ability.name}</span> (Lv ${ABILITY_UNLOCK_LEVEL}) \u2014 ${ability.desc}</p>
    </div>
  `;
  }).join('');

  const continueRow = hasSaveData()
    ? `
    <div class="continue-row">
      <button class="seal-btn wide" data-action="continue-adventure">\u{1F4DC} Continue Your Adventure</button>
      <button class="icon-btn" data-action="trigger-import" title="Import Save Data">\u{1F4E4}</button>
    </div>
    <p class="scene-text"><em>Starting a new journey below will overwrite your saved adventure.</em></p>
  `
    : `
    <div class="continue-row">
      <button class="icon-btn" data-action="trigger-import" title="Import Save Data">\u{1F4E4}</button>
      <p class="scene-text" style="margin:0;"><em>No saved adventure found on this device \u2014 import one, or begin fresh below.</em></p>
    </div>
  `;

  const html = `
    <p class="scene-eyebrow">Ashfall Road</p>
    <h2 class="scene-title">Choose Your Path</h2>
    ${continueRow}
    <hr class="divider">
    <p class="scene-text">Before the road takes you anywhere, it asks who you are.</p>
    <div class="card-grid">${cards}</div>
  `;
  setScene(html);
}

function sceneTown() {
  const loc = LOCATIONS[state.player.location];
  const p = state.player;

  let extraButtons = '';
  if (loc.wizardTower) extraButtons += `<button class="seal-btn steel" data-action="open-wizard">\u{1F52E} Wizard's Tower</button>`;

  let endingButtons = '';
  if (loc.isFinalTown) {
    endingButtons += `<button class="seal-btn" data-action="end-journey" data-ending="traveler">\u{1F3C1} Conclude Your Journey</button>`;
  }
  if (p.gold >= WEALTH_THRESHOLD) {
    endingButtons += `<button class="seal-btn" data-action="end-journey" data-ending="merchant">\u{1F4B0} Retire Wealthy</button>`;
  }
  if (p.level >= LEVEL_THRESHOLD) {
    endingButtons += `<button class="seal-btn" data-action="end-journey" data-ending="legend">\u{1F3C6} Retire as a Legend</button>`;
  }

  const html = `
    <p class="scene-eyebrow">${loc.tagline}</p>
    <h2 class="scene-title">${loc.name}</h2>
    <p class="scene-text">${loc.description}</p>
    <div class="action-row">
      <button class="seal-btn" data-action="open-shop">\u{1F3EA} Shop</button>
      <button class="seal-btn forest" data-action="open-inn">\u{1F6CF}\uFE0F Inn</button>
      <button class="seal-btn steel" data-action="open-travel">\u{1F9ED} Travel</button>
      ${extraButtons}
    </div>
    ${endingButtons ? `<hr class="divider"><p class="scene-eyebrow">The road could end here.</p><div class="action-row">${endingButtons}</div>` : ''}
  `;
  setScene(html);
}

function shopItemRow(entry, idx) {
  const item = entry.item;
  const soldOut = !entry.infinite && entry.sold;
  const disabled = soldOut || state.player.gold < entry.price;
  const nameClass = item.slot ? `rarity-${item.rarity}` : '';
  const modsLine = item.slot
    ? modsToHtml(item.mods)
    : `<div class="item-mods">${effectToText(item.effect) || 'A useful trinket.'}</div>`;
  const label = soldOut ? 'Sold' : 'Buy';
  return `
    <div class="item-row">
      <span class="item-icon">${item.icon || '\u2754'}</span>
      <div class="item-main">
        <div class="item-name-row"><span class="item-name ${nameClass}">${item.name}</span></div>
        ${modsLine}
      </div>
      <div class="item-actions">
        <span class="card-price"><span class="coin">\u25C6</span> ${entry.price}</span>
        <button class="small-btn buy" data-action="buy-item" data-idx="${idx}" ${disabled ? 'disabled' : ''}>${label}</button>
      </div>
    </div>
  `;
}

function sellItemRow(item) {
  const price = Math.max(1, Math.round(item.value * 0.5));
  const nameClass = item.slot ? `rarity-${item.rarity}` : '';
  const modsLine = item.slot ? modsToHtml(item.mods) : '';
  return `
    <div class="item-row">
      <span class="item-icon">${item.icon || '\u2754'}</span>
      <div class="item-main">
        <div class="item-name-row">
          <span class="item-name ${nameClass}">${item.name}</span>
          ${item.qty > 1 ? `<span class="item-qty">x${item.qty}</span>` : ''}
        </div>
        ${modsLine}
      </div>
      <div class="item-actions">
        <span class="card-price"><span class="coin">\u25C6</span> ${price}</span>
        <button class="small-btn sell" data-action="sell-item" data-uid="${item.uid}">Sell</button>
      </div>
    </div>
  `;
}

function sceneShop() {
  const loc = LOCATIONS[state.player.location];
  const forSaleHtml = loc.shopStock.map((entry, idx) => shopItemRow(entry, idx)).join('');
  const sellables = state.player.inventory;
  const sellHtml = sellables.length ? sellables.map(sellItemRow).join('') : `<p class="empty-note">You have nothing to sell.</p>`;
  const restockHtml = (state.settings && state.settings.showRestockTimer)
    ? `<p class="restock-timer">\u{1F504} Restocks in ${Math.max(0, SHOP_RESTOCK_INTERVAL - (state.turnCount - loc.lastRestockTurn))} turns</p>`
    : '';
  const html = `
    <p class="scene-eyebrow">${loc.name} &middot; Market</p>
    <h2 class="scene-title">The Shop</h2>
    ${restockHtml}
    <p class="scene-text">Coin changes hands. The merchant eyes your gear with practiced interest.</p>
    <h3 class="section-heading">For Sale</h3>
    <div class="item-list">${forSaleHtml}</div>
    <h3 class="section-heading">Sell Your Goods</h3>
    <div class="item-list">${sellHtml}</div>
    <hr class="divider">
    <div class="action-row"><button class="ghost-btn" data-action="back-town">&larr; Back to Town</button></div>
  `;
  setScene(html);
}

function sceneInn() {
  const loc = LOCATIONS[state.player.location];
  const html = `
    <p class="scene-eyebrow">${loc.name} &middot; Lodging</p>
    <h2 class="scene-title">The Inn</h2>
    <p class="scene-text">A fire crackles low. The innkeep nods toward the stairs.</p>
    <div class="card-grid">
      <div class="card">
        <div class="card-title-row"><span class="card-title">Regular Bed</span></div>
        <p class="card-desc">A creaky cot, but the roof doesn't leak. Restores your health fully.</p>
        <div class="card-footer">
          <span class="card-price"><span class="coin">\u25C6</span> ${loc.inn.regular}</span>
          <button class="small-btn buy" data-action="rest-regular" ${state.player.gold < loc.inn.regular ? 'disabled' : ''}>Rest</button>
        </div>
      </div>
      <div class="card">
        <div class="card-title-row"><span class="card-title">Premium Bed</span><span class="card-tag danger-1">Buff</span></div>
        <p class="card-desc">Feather down and warmed stones. Restores health fully and leaves you sharper for the road ahead, for a few turns.</p>
        <div class="card-footer">
          <span class="card-price"><span class="coin">\u25C6</span> ${loc.inn.premium}</span>
          <button class="small-btn buy" data-action="rest-premium" ${state.player.gold < loc.inn.premium ? 'disabled' : ''}>Rest</button>
        </div>
      </div>
    </div>
    <hr class="divider">
    <div class="action-row"><button class="ghost-btn" data-action="back-town">&larr; Back to Town</button></div>
  `;
  setScene(html);
}

function enchantCost(item) { return Math.round(40 + item.value); }

// Flat stats (Attack/Defense/Speed/Max HP) roll a handful of integer points.
// Crit Chance/Damage are fractional multipliers under the hood (0.08 = 8%),
// so they need their own, much smaller, scale — the same randInt(3,6) used
// for flat stats would be wildly overpowered applied directly to a percentage.
const PCT_ENCHANT_STATS = new Set(['critChance', 'critDamage']);
function enchantAmountFor(statKey) {
  if (statKey === 'critChance') return randInt(3, 6) / 100;   // +3%..+6%
  if (statKey === 'critDamage') return randInt(10, 20) / 100; // +10%..+20%
  return randInt(3, 6);
}
function formatEnchantAmount(statKey, amount) {
  return PCT_ENCHANT_STATS.has(statKey) ? `${Math.round(amount * 100)}%` : `${amount}`;
}

function enchantableItemRow(item) {
  const cost = enchantCost(item);
  const p = state.player;
  const currentLine = item.enchant
    ? `<div class="item-mods">Enchanted: <span class="pos">+${formatEnchantAmount(item.enchant.stat, item.enchant.amount)} ${labelForStat(item.enchant.stat)}</span></div>`
    : `<div class="item-mods">Unenchanted</div>`;
  const stats = ['attack', 'defense', 'speed', 'maxHp', 'critChance', 'critDamage'];
  const buttons = stats.map(s => `<button class="small-btn buy enchant-btn" data-action="enchant-item" data-uid="${item.uid}" data-stat="${s}" ${p.gold < cost ? 'disabled' : ''}>${labelForStat(s)} (${cost}g)</button>`).join('');
  return `
    <div class="item-row enchant-row">
      <div class="enchant-row-top">
        <span class="item-icon">${item.icon || '\u{1F48D}'}</span>
        <div class="item-main">
          <div class="item-name-row"><span class="item-name rarity-${item.rarity}">${item.name}</span></div>
          ${modsToHtml(item.mods)}
          ${currentLine}
        </div>
      </div>
      <div class="enchant-buttons">${buttons}</div>
    </div>
  `;
}

function sceneWizardHub() {
  const loc = LOCATIONS[state.player.location];
  const html = `
    <p class="scene-eyebrow">${loc.name} &middot; The Wizard's Tower</p>
    <h2 class="scene-title">The Wizard's Tower</h2>
    <p class="scene-text">Candles float, untethered, in the still air. A robed figure looks up from a bench cluttered with rings, amulets, and rolled parchment. "Enchanting, or scrolls?" they ask, without much interest in which.</p>
    <div class="action-row">
      <button class="seal-btn steel" data-action="open-wizard-enchant">\u{1F48D} Enchant Gear</button>
      <button class="seal-btn" style="background:radial-gradient(circle at 32% 28%, #7a5fc4, #4b3480 55%, #2c1f57 100%);" data-action="open-wizard-spells">\u{1F4DC} Spell Scrolls</button>
    </div>
    <hr class="divider">
    <div class="action-row"><button class="ghost-btn" data-action="back-town">&larr; Leave the Tower</button></div>
  `;
  setScene(html);
}

function sceneWizardEnchant() {
  const loc = LOCATIONS[state.player.location];
  const p = state.player;
  const items = [];
  if (p.equipment.weapon) items.push(p.equipment.weapon);
  if (p.equipment.trinket) items.push(p.equipment.trinket);
  items.push(...p.inventory.filter(it => it.slot === 'trinket' || it.slot === 'weapon'));
  const rows = items.length
    ? items.map(enchantableItemRow).join('')
    : `<p class="empty-note">You carry nothing to enchant. Weapons and trinkets can be found or bought around the realm.</p>`;
  const html = `
    <p class="scene-eyebrow">${loc.name} &middot; The Wizard's Tower</p>
    <h2 class="scene-title">Enchantments</h2>
    <p class="scene-text">"A blade, a ring, an amulet \u2014 I don't much care which," the wizard says. "Armor is beyond me. Bring coin."</p>
    <div class="item-list">${rows}</div>
    <hr class="divider">
    <div class="action-row"><button class="ghost-btn" data-action="open-wizard">&larr; Back to the Tower</button></div>
  `;
  setScene(html);
}

function classCanCastSpells(classId) {
  return !!(CLASSES[classId] && CLASSES[classId].baseMaxMana > 0);
}

function spellScrollRow(sp) {
  const p = state.player;
  const canCast = classCanCastSpells(p.classId);
  const known = p.knownSpells.includes(sp.id);
  let actionHtml;
  if (known) {
    actionHtml = `<button class="small-btn" disabled>Learned</button>`;
  } else if (!canCast) {
    actionHtml = `<button class="small-btn" disabled title="Only spellcasters can channel arcane scrolls.">Casters Only</button>`;
  } else {
    const disabled = p.gold < sp.scrollPrice;
    actionHtml = `<button class="small-btn buy" data-action="buy-spell" data-spell="${sp.id}" ${disabled ? 'disabled' : ''}>Learn</button>`;
  }
  return `
    <div class="item-row">
      <span class="item-icon">\u{1F4DC}</span>
      <div class="item-main">
        <div class="item-name-row"><span class="item-name">${sp.name}</span><span class="item-qty">${sp.manaCost} MP</span></div>
        <div class="item-mods">${sp.desc}</div>
      </div>
      <div class="item-actions">
        <span class="card-price"><span class="coin">\u25C6</span> ${sp.scrollPrice}</span>
        ${actionHtml}
      </div>
    </div>
  `;
}

function sceneWizardSpells() {
  const loc = LOCATIONS[state.player.location];
  const p = state.player;
  const rows = SPELLS.map(spellScrollRow).join('');
  const noteHtml = !classCanCastSpells(p.classId)
    ? `<p class="scene-text"><em>Only spellcasting classes can learn from these scrolls \u2014 but coin spends the same regardless of who's browsing.</em></p>`
    : '';
  const html = `
    <p class="scene-eyebrow">${loc.name} &middot; The Wizard's Tower</p>
    <h2 class="scene-title">Spell Scrolls</h2>
    <p class="scene-text">Shelves of tightly rolled parchment, each humming faintly with what it contains. "Read one, and you'll know the spell for good," the wizard says.</p>
    ${noteHtml}
    <div class="item-list">${rows}</div>
    <hr class="divider">
    <div class="action-row"><button class="ghost-btn" data-action="open-wizard">&larr; Back to the Tower</button></div>
  `;
  setScene(html);
}

function sceneTravelChoice() {
  const loc = LOCATIONS[state.player.location];
  const cards = loc.connections.map((c, idx) => `
    <div class="card ${c.sideRoad ? 'side-road-card' : ''}" data-action="travel-select" data-idx="${idx}" role="button" tabindex="0">
      <div class="card-title-row">
        <span class="card-title">${c.sideRoad ? '\u{1F480} ' : ''}${c.name}</span>
        <span class="card-tag danger-${Math.min(c.danger, 4)} ${c.sideRoad ? 'side-road-tag' : ''}">Danger ${c.danger}</span>
      </div>
      <p class="card-desc">${c.desc}</p>
      ${c.sideRoad ? `<p class="card-desc"><em>A faded, overgrown route \u2014 its length shifts every time you take it (roughly ${c.minSteps}\u2013${c.maxSteps} stretches).</em></p>` : ''}
      <div class="card-footer">
        <span class="card-price">${c.to === state.player.location ? 'A loop back to town' : 'Leads to ' + LOCATIONS[c.to].name}</span>
      </div>
    </div>
  `).join('');
  const html = `
    <p class="scene-eyebrow">${loc.name}</p>
    <h2 class="scene-title"><span class="compass">\u{1F9ED}</span> Choose Your Road</h2>
    <p class="scene-text">Several paths leave town, each carrying its own risk and its own reward.</p>
    <div class="card-grid">${cards}</div>
    <hr class="divider">
    <div class="action-row"><button class="ghost-btn" data-action="back-town">&larr; Stay in Town</button></div>
  `;
  setScene(html);
}

function sceneTraveling() {
  const t = state.travelState;
  if (!t) { state.screen = 'town'; return sceneTown(); }
  const conn = t.conn;
  const done = t.stepsRemaining <= 0;
  const html = `
    <p class="scene-eyebrow">${conn.name} &middot; Danger ${conn.danger}</p>
    <h2 class="scene-title">On the Road</h2>
    <p class="scene-text">${done ? `The road opens ahead, and you can make out ${LOCATIONS[conn.to].name} just beyond.` : conn.desc}</p>
    <p class="scene-text"><em>Progress: ${t.totalSteps - t.stepsRemaining} / ${t.totalSteps}</em></p>
    <div class="action-row">
      ${done
        ? `<button class="seal-btn" data-action="travel-arrive">Arrive at ${LOCATIONS[conn.to].name}</button>`
        : `<button class="seal-btn" data-action="travel-continue">Press Onward</button>`}
    </div>
  `;
  setScene(html);
}

function combatItemPanel(consumables) {
  if (!consumables.length) {
    return `<p class="empty-note">You have no items to use.</p><div class="action-row"><button class="ghost-btn" data-action="combat-item-back">&larr; Back</button></div>`;
  }
  const rows = consumables.map(it => `
    <div class="item-row">
      <span class="item-icon">${it.icon || '\u{1F9EA}'}</span>
      <div class="item-main">
        <div class="item-name-row"><span class="item-name">${it.name}</span>${it.qty > 1 ? `<span class="item-qty">x${it.qty}</span>` : ''}</div>
        <div class="item-mods">${effectToText(it.effect)}</div>
      </div>
      <div class="item-actions"><button class="small-btn buy" data-action="combat-item" data-uid="${it.uid}">Use</button></div>
    </div>
  `).join('');
  return `<div class="item-list">${rows}</div><div class="action-row"><button class="ghost-btn" data-action="combat-item-back">&larr; Back</button></div>`;
}

function combatSpellPanel() {
  const p = state.player;
  const known = SPELLS.filter(sp => p.knownSpells.includes(sp.id));
  if (!known.length) {
    return `<p class="empty-note">You don't know any spells yet.</p><div class="action-row"><button class="ghost-btn" data-action="combat-spell-back">&larr; Back</button></div>`;
  }
  const rows = known.map(sp => {
    const disabled = p.mana < sp.manaCost;
    return `
    <div class="item-row">
      <span class="item-icon">\u{1F52E}</span>
      <div class="item-main">
        <div class="item-name-row"><span class="item-name">${sp.name}</span><span class="item-qty">${sp.manaCost} MP</span></div>
        <div class="item-mods">${sp.desc}</div>
      </div>
      <div class="item-actions"><button class="small-btn buy" data-action="combat-cast" data-spell="${sp.id}" ${disabled ? 'disabled' : ''}>Cast</button></div>
    </div>`;
  }).join('');
  return `<div class="item-list">${rows}</div><div class="action-row"><button class="ghost-btn" data-action="combat-spell-back">&larr; Back</button></div>`;
}

function sceneCombat() {
  const c = state.combatState;
  if (!c) { state.screen = 'town'; return sceneTown(); }
  const p = state.player;
  const stats = computeStats(p);
  const hpPct = clampPct(p.hp, stats.maxHp);
  const mPct = clampPct(c.monster.curHp, c.monster.hp);
  const logHtml = c.log.slice(-6).map(l => `<p>${l}</p>`).join('');
  const fragileNow = hasDebuff('fragile');

  let actionHtml;
  if (c.victory) {
    actionHtml = `<div class="action-row"><button class="seal-btn" data-action="combat-continue">Continue</button></div>`;
  } else if (c.showItems) {
    actionHtml = combatItemPanel(p.inventory.filter(it => it.type === 'consumable'));
  } else if (c.showSpells) {
    actionHtml = combatSpellPanel();
  } else {
    const hasItems = p.inventory.some(it => it.type === 'consumable');
    const canCast = stats.maxMana > 0;
    const counterHtml = c.dodgeReady
      ? `<div class="action-row"><button class="seal-btn counter-btn" data-action="combat-counter">\u26A1 Counterattack!</button></div>`
      : '';
    actionHtml = `
      ${counterHtml}
      <div class="action-row">
        <button class="seal-btn" data-action="combat-attack">\u2694\uFE0F Attack</button>
        ${canCast ? `<button class="seal-btn" style="background:radial-gradient(circle at 32% 28%, #7a5fc4, #4b3480 55%, #2c1f57 100%);" data-action="combat-open-spells">\u{1F52E} Cast (${p.mana}/${stats.maxMana} MP)</button>` : ''}
        <button class="seal-btn steel" data-action="combat-open-items" ${hasItems ? '' : 'disabled'}>\u{1F9EA} Item</button>
        <button class="seal-btn" style="background:radial-gradient(circle at 32% 28%, #6fa5c7, #3f6fa8 55%, #223a57 100%);" data-action="combat-dodge">\u{1F4A8} Dodge</button>
        <button class="seal-btn steel${fragileNow ? ' ineffective' : ''}" data-action="combat-brace" title="${fragileNow ? "You're Fragile \u2014 Brace won't help!" : 'Brace: +4 Defense for 2 turns, shortens your afflictions by a turn, and halves the chance new ones land.'}">\u{1F6E1}\uFE0F Brace${fragileNow ? ' (Fragile)' : ''}</button>
        <button class="seal-btn forest" data-action="combat-flee">\u{1F45F} Flee</button>
      </div>`;
  }

  const html = `
    <p class="scene-eyebrow">Danger ${c.danger}${c.monster.isBoss ? ' &middot; Boss' : ''}</p>
    <h2 class="scene-title">${c.victory ? 'Victory!' : 'Combat'}</h2>
    <div class="combat-grid">
      <div class="combatant">
        <span class="combatant-icon">${CLASSES[p.classId].icon}</span>
        <p class="combatant-name">You</p>
        <div class="bar"><div class="bar-fill hp-fill" style="width:${hpPct}%"></div></div>
        <span class="bar-text small">${p.hp} / ${stats.maxHp}</span>
        <div class="debuff-row">${debuffChipsHtml()}</div>
      </div>
      <span class="vs-mark">VS</span>
      <div class="combatant">
        ${c.monster.isBoss ? `<span class="level-badge boss-badge">BOSS</span>` : `<span class="level-badge">Lv ${c.monster.level}</span>`}
        <span class="combatant-icon">${c.monster.icon}</span>
        <p class="combatant-name">${c.monster.name}</p>
        ${c.monster.inflicts && DEBUFFS[c.monster.inflicts.debuff] ? `<span class="inflict-tag" title="${DEBUFFS[c.monster.inflicts.debuff].desc}">${DEBUFFS[c.monster.inflicts.debuff].icon} Inflicts ${DEBUFFS[c.monster.inflicts.debuff].name}</span>` : ''}
        <div class="bar"><div class="bar-fill hp-fill" style="width:${mPct}%"></div></div>
        <span class="bar-text small">${c.monster.curHp} / ${c.monster.hp}</span>
      </div>
    </div>
    <div class="combat-log">${logHtml}</div>
    ${actionHtml}
  `;
  setScene(html);
}

function sceneGameOver() {
  const html = `
    <p class="scene-eyebrow">The Road Ends&hellip; For Now</p>
    <h2 class="scene-title gameover-title">You Have Fallen</h2>
    <p class="scene-text">Darkness takes you &mdash; but the road is patient. You wake in Millhaven, lighter of purse, but alive.</p>
    <div class="action-row"><button class="seal-btn" data-action="respawn">Wake in Millhaven</button></div>
  `;
  setScene(html);
}

function sceneEnding() {
  const e = ENDINGS[state.endingId];
  const p = state.player;
  const html = `
    <p class="scene-eyebrow">${e.tagline}</p>
    <h2 class="scene-title ending-title">${e.title}</h2>
    <p class="scene-text">${e.text}</p>
    <p class="scene-text"><em>Level ${p.level} ${CLASSES[p.classId].name} &middot; ${p.gold} gold &middot; ${state.turnCount} turns taken</em></p>
    <div class="action-row"><button class="seal-btn" data-action="new-game">Begin a New Journey</button></div>
  `;
  setScene(html);
}

/* ---------------------------------------------------------
   12. actions: town, shop, inn, wizard
   --------------------------------------------------------- */
function buyItem(idx) {
  const p = state.player;
  const loc = LOCATIONS[p.location];
  const entry = loc.shopStock[idx];
  if (!entry) return;
  if (!entry.infinite && entry.sold) return;
  if (p.gold < entry.price) return;
  p.gold -= entry.price;
  const boughtItem = entry.infinite ? { ...entry.item, uid: uid() } : entry.item;
  addToInventory(p, boughtItem);
  if (!entry.infinite) entry.sold = true;
  log(`You buy ${entry.item.name} for ${entry.price} gold.`, 'gold');
  renderAll();
}

function sellItem(itemUid) {
  const p = state.player;
  const idx = p.inventory.findIndex(it => it.uid === itemUid);
  if (idx === -1) return;
  const item = p.inventory[idx];
  const price = Math.max(1, Math.round(item.value * 0.5));
  p.gold += price;
  removeOneFromInventory(p, itemUid);
  log(`You sell ${item.name} for ${price} gold.`, 'gold');
  renderAll();
}

function restRegular() {
  const p = state.player;
  const loc = LOCATIONS[p.location];
  const price = loc.inn.regular;
  if (p.gold < price) return;
  p.gold -= price;
  p.hp = computeStats(p).maxHp;
  log('You rest at the inn and wake fully healed.', 'good');
  renderAll();
}

function restPremium() {
  const p = state.player;
  const loc = LOCATIONS[p.location];
  const price = loc.inn.premium;
  if (p.gold < price) return;
  p.gold -= price;
  p.hp = computeStats(p).maxHp;
  const stat = choice(['attack', 'defense', 'speed']);
  const amount = randInt(3, 5);
  addBuff(p, { stat, amount, turns: 6 });
  log(`You rest in the premium bed, fully healed and feeling the effects of ${labelForStat(stat)} (+${amount} for 6 turns).`, 'good');
  renderAll();
}

function equipItem(itemUid) {
  const p = state.player;
  const idx = p.inventory.findIndex(it => it.uid === itemUid);
  if (idx === -1) return;
  const item = p.inventory[idx];
  if (!item.slot) return;
  if (!canEquip(item)) {
    const classDef = CLASSES[p.classId];
    log(`${classDef.name}s can't use ${item.name}.`, 'bad');
    renderAll();
    return;
  }
  const old = p.equipment[item.slot];
  p.equipment[item.slot] = item;
  p.inventory.splice(idx, 1);
  if (old) p.inventory.push(old);
  clampVitals();
  log(`You equip ${item.name}.`, 'good');
  renderAll();
}

function unequipSlot(slot) {
  const p = state.player;
  const item = p.equipment[slot];
  if (!item) return;
  p.equipment[slot] = null;
  p.inventory.push(item);
  clampVitals();
  log(`You unequip ${item.name}.`, null);
}

function handleSlotClick(slot) {
  if (state.player.equipment[slot]) {
    unequipSlot(slot);
    renderAll();
  } else {
    openInventory();
  }
}

function useItemOutOfCombat(itemUid) {
  const p = state.player;
  const item = p.inventory.find(it => it.uid === itemUid);
  if (!item || item.type !== 'consumable') return;
  applyConsumable(item);
  removeOneFromInventory(p, itemUid);
  tickTurn();
  renderAll();
}

function openInventory() {
  document.getElementById('inventory-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
}
function toggleInventory() {
  document.getElementById('inventory-drawer').classList.toggle('open');
  document.getElementById('drawer-backdrop').classList.toggle('open');
}

function enchantItem(itemUid, statKey) {
  const p = state.player;
  const enchantable = it => it && (it.slot === 'trinket' || it.slot === 'weapon');
  const item = [p.equipment.weapon, p.equipment.trinket, ...p.inventory].find(it => enchantable(it) && it.uid === itemUid);
  if (!item) {
    log("The wizard can't find that item among your things.", 'bad');
    renderAll();
    return;
  }
  const cost = enchantCost(item);
  if (p.gold < cost) {
    log(`You can't afford that enchantment (${cost} gold).`, 'bad');
    renderAll();
    return;
  }
  p.gold -= cost;
  if (item.enchant) {
    item.mods[item.enchant.stat] = (item.mods[item.enchant.stat] || 0) - item.enchant.amount;
    if (Math.abs(item.mods[item.enchant.stat]) < 1e-9) delete item.mods[item.enchant.stat];
  }
  const amount = enchantAmountFor(statKey);
  item.mods[statKey] = (item.mods[statKey] || 0) + amount;
  item.enchant = { stat: statKey, amount };
  clampVitals();
  log(`The wizard enchants your ${item.name} with +${formatEnchantAmount(statKey, amount)} ${labelForStat(statKey)}.`, 'good');
  renderAll();
}

function buySpellScroll(spellId) {
  const p = state.player;
  const spell = SPELLS.find(s => s.id === spellId);
  if (!spell) return;
  if (!classCanCastSpells(p.classId)) return;
  if (p.knownSpells.includes(spellId)) return;
  if (p.gold < spell.scrollPrice) return;
  p.gold -= spell.scrollPrice;
  p.knownSpells.push(spellId);
  log(`You learn ${spell.name} from the scroll.`, 'good');
  renderAll();
}

/* ---------------------------------------------------------
   13. actions: travel
   --------------------------------------------------------- */
function startTravel(idx) {
  const loc = LOCATIONS[state.player.location];
  const conn = loc.connections[idx];
  if (!conn) return;
  const steps = conn.sideRoad ? randInt(conn.minSteps, conn.maxSteps) : conn.steps;
  state.travelState = { conn, stepsRemaining: steps, totalSteps: steps };
  state.screen = 'traveling';
  log(`You set out along the ${conn.name}.`, null);
  renderAll();
}

function resolveTravelStep() {
  const t = state.travelState;
  if (!t) return;
  const conn = t.conn;
  t.stepsRemaining -= 1;
  tickTurn();

  if (conn.forcedBoss) {
    const bossDef = BOSSES[conn.forcedBoss];
    startCombat(bossDef, conn.danger, 'travel');
    state.combatState.pendingEnding = conn.endingId;
    return;
  }

  const monsterChance = 0.12 + conn.danger * 0.11;
  const goldChance = 0.22;
  const itemChance = 0.22;
  const roll = Math.random();

  if (roll < monsterChance) {
    const monster = pickMonster(conn.danger);
    startCombat(monster, conn.danger, 'travel');
    return;
  } else if (roll < monsterChance + goldChance) {
    const amt = randInt(3, 6) + conn.danger * 3;
    state.player.gold += amt;
    log(`You find ${amt} gold along the way.`, 'gold');
  } else if (roll < monsterChance + goldChance + itemChance) {
    const item = rollLootItem(conn.danger);
    addToInventory(state.player, item);
    log(`You spot something and pick up: ${item.name}.`, 'good');
  } else {
    log(pickFlavorLine(), null);
  }
  state.screen = 'traveling';
  renderAll();
}

function travelArrive() {
  const t = state.travelState;
  if (!t) return;
  const destName = LOCATIONS[t.conn.to].name;
  state.player.location = t.conn.to;
  state.travelState = null;
  state.screen = 'town';
  log(`You arrive at ${destName}.`, null);
  renderAll();
}

/* ---------------------------------------------------------
   14. actions: combat
   --------------------------------------------------------- */
function startCombat(monsterDef, danger, returnTo) {
  clearDebuffs();
  const scaled = monsterDef.isBoss ? monsterDef : scaleMonsterForLevel(monsterDef, state.player.level);
  state.combatState = {
    monster: { ...scaled, curHp: scaled.hp },
    danger,
    returnTo,
    log: [monsterDef.isBoss ? `${monsterDef.name} rises before you!` : `A ${monsterDef.name} blocks your path!`],
    victory: false,
    showItems: false,
    showSpells: false,
    pendingEnding: null,
    secondWindUsed: false,
    dodgeReady: false,
  };
  state.screen = 'combat';
  renderAll();
}

// Shared damage formula for all combat hits (player attacks, monster attacks,
// spell attacks, counterattacks). Defense mitigates damage as a
// diminishing-returns percentage rather than a flat subtraction — so
// stacking Defense is always worth it, but can never fully zero out an
// attack. At least ~10% of the attacker's raw power always gets through,
// no matter how tanky the target. A critical hit multiplies the raw power
// before mitigation is applied, so heavy armor still blunts a crit somewhat
// rather than it bypassing Defense entirely.
// critChance/critDamage are optional — omit them for a hit that can never
// crit (kept for safety; every real call site passes them explicitly).
function computeDamage(rawPower, targetDefense, critChance, critDamage) {
  const isCrit = typeof critChance === 'number' && Math.random() < critChance;
  const power = isCrit ? rawPower * (critDamage || BASE_CRIT_DAMAGE) : rawPower;
  const def = Math.max(0, targetDefense);
  const mitigation = def / (def + 10); // approaches but never reaches 100%
  const mitigated = power * (1 - mitigation);
  const floor = Math.max(1, Math.round(power * 0.1));
  const variance = randInt(-2, 2);
  const dmg = Math.max(floor, Math.round(mitigated + variance));
  return { dmg, crit: isCrit };
}

function combatAttack() {
  const c = state.combatState;
  if (!c || c.victory) return;
  c.dodgeReady = false;
  const p = state.player;
  const stats = computeStats(p);
  let dmg = 0;
  if (rollDazedMiss()) {
    c.log.push(`\u{1F4AB} Dazed, you swing wide and miss the ${c.monster.name}!`);
  } else {
    const hit = scaleOutgoing(computeDamage(stats.attack, c.monster.defense, stats.critChance, stats.critDamage));
    dmg = hit.dmg;
    c.monster.curHp = Math.max(0, c.monster.curHp - dmg);
    c.log.push(hit.crit ? `\u{1F4A5} Critical hit! You strike the ${c.monster.name} for ${dmg} damage.` : `You strike the ${c.monster.name} for ${dmg} damage.`);
  }

  if (dmg > 0 && p.classId === 'berserker' && p.level >= ABILITY_UNLOCK_LEVEL) {
    const lifesteal = Math.round(dmg * 0.25);
    if (lifesteal > 0) {
      const before = p.hp;
      p.hp = Math.min(stats.maxHp, p.hp + lifesteal);
      if (p.hp > before) c.log.push(`\u{1FA78} Bloodlust! You tear ${p.hp - before} HP back from the wound.`);
    }
  }

  if (dmg > 0 && p.classId === 'spellsword' && p.level >= ABILITY_UNLOCK_LEVEL && Math.random() < 0.35) {
    const before = p.mana;
    p.mana = Math.min(stats.maxMana, p.mana + randInt(3, 5));
    if (p.mana > before) c.log.push(`\u2728 Spellblade! Your strike channels ${p.mana - before} mana back into you.`);
  }

  if (c.monster.curHp <= 0) {
    combatVictory();
    return;
  }

  if (p.classId === 'rogue' && p.level >= ABILITY_UNLOCK_LEVEL && Math.random() < 0.3) {
    if (rollDazedMiss()) {
      c.log.push(`\u{1F5E1}\uFE0F Double Attack! But, Dazed, your second strike goes wide.`);
    } else {
      const second = scaleOutgoing(computeDamage(stats.attack, c.monster.defense, stats.critChance, stats.critDamage));
      c.monster.curHp = Math.max(0, c.monster.curHp - second.dmg);
      c.log.push(second.crit
        ? `\u{1F5E1}\uFE0F Double Attack! A second strike lands \u2014 critical! ${second.dmg} damage.`
        : `\u{1F5E1}\uFE0F Double Attack! You strike again for ${second.dmg} damage.`);
      if (c.monster.curHp <= 0) {
        combatVictory();
        return;
      }
    }
  }

  monsterTurn();
}

function combatCast(spellId) {
  const c = state.combatState;
  if (!c || c.victory) return;
  c.dodgeReady = false;
  const p = state.player;
  const spell = SPELLS.find(s => s.id === spellId);
  if (!spell || !p.knownSpells.includes(spellId) || p.mana < spell.manaCost) return;

  const freeCast = p.classId === 'mage' && p.level >= ABILITY_UNLOCK_LEVEL && Math.random() < 0.25;
  if (!freeCast) p.mana -= spell.manaCost;
  c.showSpells = false;
  if (freeCast) c.log.push(`\u{1FA84} Overchannel! ${spell.name} costs no mana.`);

  if (spell.kind === 'attack') {
    const stats = computeStats(p);
    const rawDmg = randInt(spell.power[0], spell.power[1]);
    const defFactor = spell.piercing ? 0.3 : 0.6;
    const { dmg, crit } = scaleOutgoing(computeDamage(rawDmg, c.monster.defense * defFactor, stats.critChance, stats.critDamage));
    c.monster.curHp = Math.max(0, c.monster.curHp - dmg);
    c.log.push(crit ? `\u{1F4A5} Critical hit! You cast ${spell.name} for ${dmg} damage.` : `You cast ${spell.name} for ${dmg} damage.`);
    if (c.monster.curHp <= 0) { combatVictory(); return; }
  } else if (spell.kind === 'heal') {
    const stats = computeStats(p);
    const before = p.hp;
    const amt = randInt(spell.heal[0], spell.heal[1]);
    p.hp = Math.min(stats.maxHp, p.hp + amt);
    c.log.push(`You cast ${spell.name} and recover ${p.hp - before} HP.`);
  } else if (spell.kind === 'buff') {
    addBuff(p, spell.buff);
    c.log.push(`You cast ${spell.name}.`);
  }
  monsterTurn();
}

function monsterTurn(opts) {
  opts = opts || {};
  const c = state.combatState;
  const p = state.player;
  const stats = computeStats(p);
  const defEff = c.monster.magicAttack ? Math.round(stats.defense * 0.5) : stats.defense;
  const monsterCritChance = MONSTER_BASE_CRIT_CHANCE + (c.monster.critChanceBonus || 0);
  const { dmg, crit } = computeDamage(c.monster.attack, defEff, monsterCritChance, BASE_CRIT_DAMAGE);
  p.hp -= dmg;
  const verb = c.monster.magicAttack ? 'blasts' : 'hits';
  c.log.push(crit ? `\u{1F4A5} Critical! The ${c.monster.name} ${verb} you for ${dmg} damage.` : `The ${c.monster.name} ${verb} you for ${dmg} damage.`);

  tickDebuffs(c);                        // afflictions already on you tick first
  maybeInflictDebuff(c, !!opts.braced);  // then this hit may leave a new one
  checkSecondWind(c);                    // after ALL damage this round, before the death check

  p.hp = Math.max(0, p.hp);
  tickTurn();
  if (p.hp <= 0) {
    gameOver();
    return;
  }
  c.showItems = false;
  c.showSpells = false;
  renderAll();
}

// Dodge: a gamble. Success fully negates the monster's attack this round
// and opens a one-round window for a free Counterattack. Failure means you
// spent the round trying to evade and simply eat the monster's normal hit,
// same as if you'd done nothing offensive at all.
function combatDodge() {
  const c = state.combatState;
  if (!c || c.victory) return;
  c.dodgeReady = false;
  const p = state.player;
  const stats = computeStats(p);
  const chance = clamp(0.3 + (stats.speed - c.monster.speed) * 0.04, 0.1, 0.85);
  if (Math.random() < chance) {
    c.log.push(`\u{1F4A8} You dodge the ${c.monster.name}'s attack!`);
    c.dodgeReady = true;
    tickDebuffs(c);          // dodging avoids the hit, not the poison already in your blood
    checkSecondWind(c);
    p.hp = Math.max(0, p.hp);
    tickTurn();
    if (p.hp <= 0) {
      gameOver();
      return;
    }
    renderAll();
  } else {
    c.log.push(`You try to dodge, but aren't fast enough...`);
    monsterTurn();
  }
}

// Brace: the reliable option. No evasion roll — you always take the hit —
// but a guaranteed, immediate Defense buff softens it, applying to this
// very exchange since monsterTurn() recomputes stats after the buff lands.
function combatBrace() {
  const c = state.combatState;
  if (!c || c.victory) return;
  c.dodgeReady = false;
  const p = state.player;
  if (hasDebuff('fragile')) {
    c.log.push(`\u{1F494} You're too Fragile to brace \u2014 the stance does nothing!`);
    monsterTurn();
    return;
  }
  addBuff(p, { stat: 'defense', amount: 4, turns: 2 });
  c.log.push(`\u{1F6E1}\uFE0F You brace for impact, hardening your stance.`);
  if (shortenDebuffs(c, 1)) c.log.push(`Bracing steadies you \u2014 your afflictions ease.`);
  monsterTurn({ braced: true });
}

// Counterattack: only available for one decision immediately after a
// successful Dodge. A guaranteed basic attack with boosted crit odds that
// skips the monster's turn entirely — a real reward for the gamble paying off.
function combatCounter() {
  const c = state.combatState;
  if (!c || c.victory || !c.dodgeReady) return;
  c.dodgeReady = false;
  const p = state.player;
  const stats = computeStats(p);
  if (rollDazedMiss()) {
    c.log.push(`\u{1F4AB} Dazed, your counterattack goes wide!`);
    renderAll();
    return;
  }
  const boostedCrit = Math.min(0.95, stats.critChance + COUNTER_CRIT_BONUS);
  const { dmg, crit } = scaleOutgoing(computeDamage(stats.attack, c.monster.defense, boostedCrit, stats.critDamage));
  c.monster.curHp = Math.max(0, c.monster.curHp - dmg);
  c.log.push(crit
    ? `\u26A1 Counterattack! A critical strike for ${dmg} damage!`
    : `\u26A1 Counterattack! You strike the ${c.monster.name} for ${dmg} damage.`);
  if (c.monster.curHp <= 0) { combatVictory(); return; }
  renderAll();
}

function combatVictory() {
  const c = state.combatState;
  const p = state.player;
  const gold = randInt(c.monster.gold[0], c.monster.gold[1]);
  p.gold += gold;
  c.log.push(`You defeat the ${c.monster.name}! (+${gold} gold)`);
  const xp = c.monster.xp;
  gainXp(xp);
  c.log.push(`(+${xp} XP)`);
  if (Math.random() < 0.45) {
    const item = rollLootItem(c.danger);
    addToInventory(p, item);
    c.log.push(`You find: ${item.name}.`);
  }
  tickTurn();
  clearDebuffs();
  c.victory = true;
  renderAll();
}

function combatFlee() {
  const c = state.combatState;
  if (!c || c.victory) return;
  c.dodgeReady = false;
  const p = state.player;
  const stats = computeStats(p);
  const chance = clamp(0.35 + (stats.speed - c.monster.speed) * 0.05, 0.1, 0.9);
  const returnTo = c.returnTo;
  if (Math.random() < chance) {
    tickTurn();
    clearDebuffs();
    log(`You slip away from the ${c.monster.name}.`, null);
    state.combatState = null;
    state.screen = returnTo === 'travel' ? 'traveling' : 'town';
    renderAll();
  } else {
    // monsterTurn() advances the turn itself; ticking here too would count a failed flee twice
    c.log.push('You fail to escape!');
    monsterTurn();
  }
}

function combatUseItem(itemUid) {
  const c = state.combatState;
  if (!c || c.victory) return;
  c.dodgeReady = false;
  const p = state.player;
  const item = p.inventory.find(it => it.uid === itemUid);
  if (!item) return;
  applyConsumable(item);
  c.log.push(`You use ${item.name}.`);
  removeOneFromInventory(p, itemUid);
  c.showItems = false;
  monsterTurn();
}

function combatContinue() {
  const c = state.combatState;
  if (c && c.pendingEnding && c.victory) {
    triggerEnding(c.pendingEnding);
    return;
  }
  const returnTo = c ? c.returnTo : 'town';
  state.combatState = null;
  state.screen = returnTo === 'travel' ? 'traveling' : 'town';
  renderAll();
}

function gameOver() {
  clearDebuffs();
  state.combatState = null;
  state.travelState = null;
  state.screen = 'gameover';
  log('Everything goes dark...', 'bad');
  renderAll();
}

function respawn() {
  const p = state.player;
  p.location = 'millhaven';
  p.gold = Math.floor(p.gold * 0.8);
  p.buffs = [];
  p.debuffs = [];
  const stats = computeStats(p);
  p.hp = Math.max(1, Math.floor(stats.maxHp * 0.5));
  p.mana = stats.maxMana;
  state.screen = 'town';
  log('You wake in Millhaven, shaken but alive.', null);
  renderAll();
}

/* ---------------------------------------------------------
   15. endings & new game
   --------------------------------------------------------- */
function triggerEnding(id) {
  state.combatState = null;
  state.travelState = null;
  state.screen = 'ending';
  state.endingId = id;
  log(`\u2014 ${ENDINGS[id].tagline} \u2014`, 'good');
  renderAll();
}

function startNewGame(classId) {
  state.turnCount = 0;
  buildWorld();
  state.log = [];
  state.travelState = null;
  state.combatState = null;
  state.endingId = null;
  state.player = createPlayer(classId);

  const classDef = CLASSES[classId];
  const startWeapon = generateEquipItem(classDef.startWeapon, 0, 'common');
  const startArmor = generateEquipItem(classDef.startArmor, 0, 'common');
  state.player.equipment.weapon = startWeapon;
  state.player.equipment.armor = startArmor;

  addToInventory(state.player, generateConsumableInstance('potion'));
  addToInventory(state.player, generateConsumableInstance('potion'));
  if (classDef.baseMaxMana > 0) addToInventory(state.player, generateConsumableInstance('mana_potion'));

  const stats = computeStats(state.player);
  state.player.hp = stats.maxHp;
  state.player.mana = stats.maxMana;

  state.screen = 'town';
  log(`You begin your journey as a ${classDef.name}, on the road just outside Millhaven.`, null);
  renderAll();
}

/* ---------------------------------------------------------
   16. event delegation
   --------------------------------------------------------- */
function handleAction(action, data) {
  switch (action) {
    case 'select-class': startNewGame(data.class); break;
    case 'new-game': state.screen = 'class-select'; state.player = null; renderAll(); break;

    case 'open-shop': {
      const restocked = maybeRestockShop(state.player.location);
      if (restocked) log('The shop has refreshed its stock since your last visit.', 'good');
      state.screen = 'shop';
      renderAll();
      break;
    }
    case 'open-inn': state.screen = 'inn'; renderAll(); break;
    case 'open-wizard': state.screen = 'wizard'; renderAll(); break;
    case 'open-wizard-enchant': state.screen = 'wizard-enchant'; renderAll(); break;
    case 'open-wizard-spells': state.screen = 'wizard-spells'; renderAll(); break;
    case 'buy-spell': buySpellScroll(data.spell); break;
    case 'open-travel': state.screen = 'travel-choice'; renderAll(); break;
    case 'back-town': state.screen = 'town'; renderAll(); break;

    case 'travel-select': startTravel(parseInt(data.idx, 10)); break;
    case 'travel-continue': resolveTravelStep(); break;
    case 'travel-arrive': travelArrive(); break;

    case 'buy-item': buyItem(parseInt(data.idx, 10)); break;
    case 'sell-item': sellItem(data.uid); break;

    case 'rest-regular': restRegular(); break;
    case 'rest-premium': restPremium(); break;

    case 'equip-item': equipItem(data.uid); break;
    case 'open-slot': handleSlotClick(data.slot); break;
    case 'use-item': useItemOutOfCombat(data.uid); break;
    case 'enchant-item': enchantItem(data.uid, data.stat); break;

    case 'combat-attack': combatAttack(); break;
    case 'combat-open-items': state.combatState.showItems = true; renderAll(); break;
    case 'combat-item-back': state.combatState.showItems = false; renderAll(); break;
    case 'combat-item': combatUseItem(data.uid); break;
    case 'combat-open-spells': state.combatState.showSpells = true; renderAll(); break;
    case 'combat-spell-back': state.combatState.showSpells = false; renderAll(); break;
    case 'combat-cast': combatCast(data.spell); break;
    case 'combat-dodge': combatDodge(); break;
    case 'combat-brace': combatBrace(); break;
    case 'combat-counter': combatCounter(); break;
    case 'combat-flee': combatFlee(); break;
    case 'combat-continue': combatContinue(); break;

    case 'respawn': respawn(); break;
    case 'end-journey': triggerEnding(data.ending); break;
    case 'toggle-inventory': toggleInventory(); break;
    case 'continue-adventure': continueAdventure(); break;
    case 'trigger-import': triggerImport(); break;
    case 'open-settings': openSettings(); break;
    case 'close-settings': closeSettings(); break;
    case 'toggle-setting':
      state.settings[data.setting] = !state.settings[data.setting];
      applySettings();
      saveSettingsToStorage();
      renderSettingsContent();
      break;
    case 'manual-save': manualSave(); break;
    case 'export-save': exportSave(); break;
    case 'change-export-folder': changeExportFolder(); break;
    case 'return-title': returnToTitle(); break;
    case 'delete-save': confirmDeleteSave(); break;
    default: break;
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  handleAction(el.dataset.action, el.dataset);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[data-action][role="button"]');
  if (!el) return;
  e.preventDefault();
  handleAction(el.dataset.action, el.dataset);
});

/* ---------------------------------------------------------
   17. init
   --------------------------------------------------------- */
let _hasInitialized = false;
function initGame() {
  if (_hasInitialized) return;
  _hasInitialized = true;
  state.settings = loadSettingsFromStorage();
  applySettings();
  state.screen = 'class-select';
  renderAll();
}

const importInput = document.getElementById('import-file-input');
if (importInput) importInput.addEventListener('change', handleImportFileSelected);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGame);
} else {
  initGame();
}
