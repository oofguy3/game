import type { BuildingType, UnitType } from '../../shared/types';

export const BUILDING_LABELS: Record<BuildingType, string> = {
  city: 'City',
  factory: 'Factory',
  barracks: 'Barracks',
  bank: 'Bank',
  defensePost: 'Defense post',
  fortress: 'Fortress',
  port: 'Port',
  navalBase: 'Naval base',
  airport: 'Airport',
  antiAir: 'Anti-air gun',
  radar: 'Radar station',
  capital: 'Capital',
};

export const BUILDING_HINTS: Record<BuildingType, string> = {
  city: 'More max troops',
  factory: 'More gold',
  barracks: 'Troops grow faster',
  bank: 'Gold and better trade',
  defensePost: 'Nearby land is harder to take',
  fortress: 'Big defense over a large area',
  port: 'Trade ships and more boats (coast only)',
  navalBase: 'Builds warships (coast only)',
  airport: 'Planes and trade planes',
  antiAir: 'Shoots down enemy planes',
  radar: 'Warns of planes, boosts anti-air',
  capital: 'Lose it and you are out',
};

export const UNIT_LABELS: Record<UnitType, string> = {
  troopBoat: 'troop boat',
  tradeShip: 'trade ship',
  warship: 'warship',
  tradePlane: 'trade plane',
  bomber: 'bomber',
  paraPlane: 'paratrooper plane',
  fighter: 'fighter',
};
