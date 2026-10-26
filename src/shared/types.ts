export type NationId = number;   // 0 = unowned
export type TileIndex = number;  // y * width + x
export const Terrain = { Water: 0, Plains: 1, Hills: 2, Mountains: 3 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];
export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';
export type Personality = 'aggressive' | 'builder' | 'trader' | 'opportunist' | 'diplomat';
export type BuildingType = 'city' | 'factory' | 'barracks' | 'bank' | 'defensePost' | 'fortress'
  | 'port' | 'navalBase' | 'airport' | 'antiAir' | 'radar' | 'missileSilo' | 'samLauncher';
export const BUILDING_TYPES: readonly BuildingType[] = ['city', 'factory', 'barracks', 'bank', 'defensePost',
  'fortress', 'port', 'navalBase', 'airport', 'antiAir', 'radar', 'missileSilo', 'samLauncher'];
export type UnitType = 'troopBoat' | 'tradeShip' | 'warship' | 'tradePlane' | 'bomber' | 'paraPlane' | 'fighter' | 'missile';
/** A warhead launched from a missile silo. */
export type NukeKind = 'atom' | 'hydrogen' | 'mirv';
export type NationRole = 'nation' | 'tribe';
export type GameMode = 'ffa' | 'nations';
export type Relation = 'neutral' | 'allied' | 'war';
export type Phase = 'spawn' | 'playing' | 'ended';
export type MapSize = 'small' | 'medium' | 'large';
export type MapChoice = { kind: 'world' } | { kind: 'random'; size: MapSize; seed: number } | { kind: 'box'; size: MapSize; seed: number };
export interface Deal { giveGold: number; giveTroops: number; getGold: number; getTroops: number }
export interface DiplomacyRequest {
  id: number; kind: 'alliance' | 'peace' | 'deal' | 'jointAttack'; from: NationId; to: NationId;
  expiresAt: number; deal?: Deal; target?: NationId;
}
export type Command =
  | { type: 'spawn'; nation: NationId; tile: TileIndex }
  | { type: 'attack'; nation: NationId; tile: TileIndex; ratio: number; allowBoat?: boolean }
  | { type: 'boat'; nation: NationId; tile: TileIndex; ratio: number }
  | { type: 'build'; nation: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildUnit'; nation: NationId; unit: 'warship' | 'fighter'; buildingId: number }
  | { type: 'moveUnit'; nation: NationId; unitId: number; tile: TileIndex }
  | { type: 'bomb'; nation: NationId; tile: TileIndex }
  | { type: 'paradrop'; nation: NationId; tile: TileIndex; ratio: number }
  | { type: 'proposeAlliance'; nation: NationId; to: NationId }
  | { type: 'breakAlliance'; nation: NationId; with: NationId }
  | { type: 'proposePeace'; nation: NationId; to: NationId }
  | { type: 'proposeDeal'; nation: NationId; to: NationId; deal: Deal }
  | { type: 'requestJointAttack'; nation: NationId; to: NationId; target: NationId }
  | { type: 'respond'; nation: NationId; requestId: number; accept: boolean }
  | { type: 'embargo'; nation: NationId; with: NationId; on: boolean }
  | { type: 'nuke'; nation: NationId; tile: TileIndex; kind: NukeKind }
  | { type: 'clean'; nation: NationId; tile: TileIndex }
  | { type: 'debugGrant'; nation: NationId; gold?: number; troops?: number }; // only when GameSetup.debug
export interface GameResult { winners: NationId[]; reason: 'landShare' | 'lastStanding' | 'alliance' }
export type GameEvent =
  | { type: 'rejected'; nation: NationId; reason: string }
  | { type: 'spawned'; nation: NationId; tile: TileIndex }
  | { type: 'phase'; phase: Phase }
  | { type: 'attackStarted'; attacker: NationId; target: NationId; troops: number }
  | { type: 'eliminated'; nation: NationId; by: NationId } // by 0: found nowhere to start
  | { type: 'buildingDone'; nation: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildingCaptured'; from: NationId; to: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildingDestroyed'; owner: NationId; by: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'landed'; nation: NationId; tile: TileIndex; troops: number }
  | { type: 'bombed'; by: NationId; owner: NationId; tile: TileIndex }
  | { type: 'unitLost'; owner: NationId; by: NationId; unit: UnitType }
  | { type: 'trade'; nation: NationId; partner: NationId; gold: number }
  | { type: 'radarWarning'; nation: NationId; from: NationId; unit: UnitType; tile: TileIndex }
  | { type: 'request'; request: DiplomacyRequest }
  | { type: 'requestResolved'; requestId: number; kind: DiplomacyRequest['kind']; from: NationId; to: NationId; accepted: boolean }
  | { type: 'relation'; a: NationId; b: NationId; relation: Relation }
  | { type: 'betrayal'; betrayer: NationId; victim: NationId }
  | { type: 'nuked'; by: NationId; owner: NationId; tile: TileIndex; kind: NukeKind }
  | { type: 'nukeIntercepted'; by: NationId; owner: NationId; tile: TileIndex }
  | { type: 'gameOver'; result: GameResult };
