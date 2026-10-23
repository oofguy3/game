export type NationId = number;   // 0 = unowned
export type TileIndex = number;  // y * width + x
export const Terrain = { Water: 0, Plains: 1, Hills: 2, Mountains: 3 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];
export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';
export type Personality = 'aggressive' | 'builder' | 'trader' | 'opportunist' | 'diplomat';
export type BuildingType = 'city' | 'factory' | 'barracks' | 'bank' | 'defensePost' | 'fortress'
  | 'port' | 'navalBase' | 'airport' | 'antiAir' | 'radar' | 'capital';
/** The building types a nation can build: every type but the capital. */
export const BUILDING_TYPES: readonly BuildingType[] = ['city', 'factory', 'barracks', 'bank', 'defensePost',
  'fortress', 'port', 'navalBase', 'airport', 'antiAir', 'radar'];
/** Every building type, the capital included: what building counts go over. */
export const ALL_BUILDING_TYPES: readonly BuildingType[] = [...BUILDING_TYPES, 'capital'];
export type UnitType = 'troopBoat' | 'tradeShip' | 'warship' | 'tradePlane' | 'bomber' | 'paraPlane' | 'fighter';
export type Relation = 'neutral' | 'allied' | 'war';
export type Phase = 'spawn' | 'playing' | 'ended';
export type MapSize = 'small' | 'medium' | 'large';
export type MapChoice = { kind: 'world' } | { kind: 'random'; size: MapSize; seed: number };
export interface Deal { giveGold: number; giveTroops: number; getGold: number; getTroops: number }
export interface DiplomacyRequest {
  id: number; kind: 'alliance' | 'peace' | 'deal' | 'jointAttack' | 'aid'; from: NationId; to: NationId;
  expiresAt: number; deal?: Deal; target?: NationId;
  /** What an aid request asks for. */
  resource?: 'troops' | 'gold';
}
/** Why a teammate says no to an ask for help: at war and losing ground, nothing to spare, or it doesn't want to now. */
export type AidRefusal = 'busy' | 'cantSpare' | 'notNow';
/** The teammate an attack helps: joining the ally's attack on the target, or striking back at the ally's attacker. */
export interface AttackSupport { ally: NationId; kind: 'join' | 'defend' }
export type Command =
  | { type: 'spawn'; nation: NationId; tile: TileIndex }
  | { type: 'attack'; nation: NationId; tile: TileIndex; ratio: number; allowBoat?: boolean; support?: AttackSupport }
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
  | { type: 'respond'; nation: NationId; requestId: number; accept: boolean; reason?: AidRefusal }
  | { type: 'embargo'; nation: NationId; with: NationId; on: boolean }
  | { type: 'sendAid'; nation: NationId; to: NationId; gold: number; troops: number }
  | { type: 'askAid'; nation: NationId; to: NationId; resource: 'troops' | 'gold' }
  | { type: 'debugGrant'; nation: NationId; gold?: number; troops?: number }; // only when GameSetup.debug
export interface GameResult {
  winners: NationId[];
  reason: 'landShare' | 'lastStanding' | 'alliance';
  /** The winning team; only in teams mode. */
  team?: number;
}
export type GameEvent =
  | { type: 'rejected'; nation: NationId; reason: string }
  | { type: 'spawned'; nation: NationId; tile: TileIndex }
  | { type: 'phase'; phase: Phase }
  | { type: 'attackStarted'; attacker: NationId; target: NationId; troops: number; support?: AttackSupport }
  // by 0: found nowhere to start; capital: knocked out by the fall of its capital (`capitalFell` says so)
  | { type: 'eliminated'; nation: NationId; by: NationId; capital?: true }
  | { type: 'buildingDone'; nation: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildingCaptured'; from: NationId; to: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildingDestroyed'; owner: NationId; by: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'landed'; nation: NationId; tile: TileIndex; troops: number }
  | { type: 'bombed'; by: NationId; owner: NationId; tile: TileIndex }
  | { type: 'unitLost'; owner: NationId; by: NationId; unit: UnitType }
  | { type: 'trade'; nation: NationId; partner: NationId; gold: number }
  | { type: 'radarWarning'; nation: NationId; from: NationId; unit: UnitType; tile: TileIndex }
  | { type: 'request'; request: DiplomacyRequest }
  | {
    type: 'requestResolved'; requestId: number; kind: DiplomacyRequest['kind']; from: NationId; to: NationId;
    accepted: boolean; reason?: AidRefusal;
  }
  | { type: 'aidSent'; from: NationId; to: NationId; gold: number; troops: number }
  | { type: 'relation'; a: NationId; b: NationId; relation: Relation }
  | { type: 'betrayal'; betrayer: NationId; victim: NationId }
  // an enemy took land within reach of `nation`'s capital, which stands on `tile`
  | { type: 'capitalThreat'; nation: NationId; tile: TileIndex }
  // `nation`'s capital fell to `by`, who took over the `tiles` other tiles it still had
  | { type: 'capitalFell'; nation: NationId; by: NationId; tiles: number }
  | { type: 'gameOver'; result: GameResult };
