/* globals
AmbientLight,
canvas,
CanvasVisibility,
ClockwiseSweepPolygon,
GlobalLightSource,
libWrapper,
LightSource,
PIXI,
RenderedPointSource,
SettingsConfig,
Tile,
Token,
VisionSource
*/

"use strict";

// Patches

import { MODULE_ID } from "./const.js";
import { getSetting, SETTINGS } from "./settings.js";

import { PATCHES as PATCHES_AdaptiveLightingShader } from "./glsl/AdaptiveLightingShader.js";
import { PATCHES as PATCHES_AmbientLight } from "./AmbientLight.js";
import { PATCHES as PATCHES_AmbientSound } from "./AmbientSound.js";
import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_ClockwiseSweepPolygon } from "./ClockwiseSweepPolygon.js";
import { PATCHES as PATCHES_PIXI_Graphics } from "./PIXI_Graphics.js";
import { PATCHES as PATCHES_GlobalLightSource } from "./GlobalLightSource.js";
import { PATCHES as PATCHES_LightSource } from "./LightSource.js";
import { PATCHES as PATCHES_RenderedPointSource } from "./RenderedPointSource.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_VisionSource } from "./VisionSource.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";

import {
  PATCHES_DetectionMode,
  PATCHES_DetectionModeBasicSight,
  PATCHES_DetectionModeTremor } from "./detection_modes.js";

import {
  PATCHES_AmbientLightConfig,
  PATCHES_AmbientSoundConfig,
  PATCHES_TileConfig } from "./render_configs.js";

import { PATCHES_Token, PATCHES_ActiveEffect } from "./Token.js";


/**
 * Groupings:
 * - BASIC        Always in effect
 * - POLYGON      When Polygon shadow setting is selected
 * - WEBGL        When WebGL shadow setting is selected
 * - SWEEP        When Sweep enhancement setting is selected
 * - VISIBILITY   When EV is responsibility for testing visibility
 *
 * Patching options:
 * - WRAPS
 * - OVERRIDES
 * - METHODS
 * - GETTERS
 * - STATIC_WRAPS
 */
export const PATCHES = {
  ActiveEffect: PATCHES_ActiveEffect,
  AdaptiveLightingShader: PATCHES_AdaptiveLightingShader,
  AmbientLight: PATCHES_AmbientLight,
  AmbientLightConfig: PATCHES_AmbientLightConfig,
  AmbientSound: PATCHES_AmbientSound,
  AmbientSoundConfig: PATCHES_AmbientSoundConfig,
  Canvas: PATCHES_Canvas,
  CanvasVisibility: PATCHES_CanvasVisibility,
  ClockwiseSweepPolygon: PATCHES_ClockwiseSweepPolygon,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  DetectionModeTremor: PATCHES_DetectionModeTremor,
  GlobalLightSource: PATCHES_GlobalLightSource,
  LightSource: PATCHES_LightSource,
  PIXI_Graphics: PATCHES_PIXI_Graphics,
  RenderedPointSource: PATCHES_RenderedPointSource,
  Tile: PATCHES_Tile,
  TileConfig: PATCHES_TileConfig,
  Token: PATCHES_Token,
  VisionSource: PATCHES_VisionSource,
  Wall: PATCHES_Wall
};


/**
 * Helper to wrap methods.
 * @param {string} method       Method to wrap
 * @param {function} fn         Function to use for the wrap
 * @param {object} [options]    Options passed to libWrapper.register. E.g., { perf_mode: libWrapper.PERF_FAST}
 * @returns {number} libWrapper ID
 */
function wrap(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.WRAPPER, options);
}

// Currently unused
// function mixed(method, fn, options = {}) {
//   return libWrapper.register(MODULE_ID, method, fn, libWrapper.MIXED, options);
// }

function override(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.OVERRIDE, options);
}

/**
 * Helper to add a method or a getter to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 * @param {object} [opts] Optional parameters
 * @param {boolean} [opts.getter]     True if the property should be made a getter.
 * @param {boolean} [opts.optional]   True if the getter should not be set if it already exists.
 * @returns {undefined|string} Either undefined if the getter already exists or the cl.prototype.name.
 */
function addClassMethod(cl, name, fn, { getter = false, optional = false } = {}) {
  if ( optional && Object.hasOwn(cl, name) ) return undefined;
  const descriptor = { configurable: true };
  if ( getter ) descriptor.get = fn;
  else {
    descriptor.writable = true;
    descriptor.value = fn;
  }
  Object.defineProperty(cl, name, descriptor);

  const prototypeName = cl.constructor?.name;
  return `${prototypeName ?? cl.name }.${prototypeName ? "prototype." : ""}${name}`;
}

// ----- NOTE: Track libWrapper patches, method additions, and hooks ----- //
/**
 * Decorator to register and record a patch, method, or hook.
 * @param {function} fn   A registration function that returns an id. E.g., libWrapper or Hooks.on.
 * @param {Map} map       The map in which to store the id along with the arguments used when registering.
 * @returns {number} The id
 */
function regDec(fn, map) {
  return function() {
    const id = fn.apply(this, arguments);
    map.set(id, arguments);
    return id;
  };
}

/**
 * Deregister shading wrappers.
 * Used when switching shadow algorithms. Deregister all, then re-register needed wrappers.
 */
function deregisterPatches(map) { map.forEach((id, _args) => libWrapper.unregister(MODULE_ID, id, false)); }

function deregisterHooks(map) {
  map.forEach((id, args) => {
    const hookName = args[0];
    Hooks.off(hookName, id);
  });
}

function deregisterMethods(map) {
  map.forEach((_id, args) => {
    const cl = args[0];
    const name = args[1];
    delete cl[name];
  });
}

// IDs returned by libWrapper.register for the shadow shader patches.
const libWrapperShaderIds = [];

/**
 * Decorator to register and record libWrapper id for a shader function.
 * @param {function} fn   A libWrapper registration function
 */
function regShaderPatch(fn) {
  return function() { libWrapperShaderIds.push(fn.apply(this, arguments)); };
}

const shaderWrap = regShaderPatch(wrap);
const shaderOverride = regShaderPatch(override);

export function registerPatches() {
  // Track mouse events
  wrap("Canvas.prototype._onMouseMove", PATCHES_Canvas.BASIC.WRAPS._onMouseMove, { perf_mode: libWrapper.PERF_FAST });

  // ----- Locating edges that create shadows in the LOS ----- //
  wrap("ClockwiseSweepPolygon.prototype._compute", PATCHES_ClockwiseSweepPolygon.POLYGONS.WRAPS._compute, { perf_mode: libWrapper.PERF_FAST });

  // ----- Token animation and elevation change ---- //
  wrap("Token.prototype.clone", PATCHES_Token.BASIC.WRAPS.clone, { perf_mode: libWrapper.PERF_FAST });

  // ----- Application rendering configurations ----- //
  wrap("AmbientSoundConfig.defaultOptions", PATCHES_AmbientSoundConfig.BASIC.STATIC_WRAPS.defaultOptions);
  wrap("TileConfig.prototype.getData", PATCHES_TileConfig.BASIC.WRAPS.getData);
  wrap("TileConfig.prototype._onChangeInput", PATCHES_TileConfig.BASIC.WRAPS._onChangeInput);

  // ----- Clockwise sweep enhancements ----- //
  if ( getSetting(SETTINGS.CLOCKWISE_SWEEP) ) {
    wrap("ClockwiseSweepPolygon.prototype.initialize", PATCHES_ClockwiseSweepPolygon.POLYGONS.SWEEP.initialize, { perf_mode: libWrapper.PERF_FAST });
  }

  // ----- Lighting elevation tooltip ----- //
  wrap("AmbientLight.prototype._draw", PATCHES_AmbientLight.BASIC.WRAPS._draw);

  // ----- Directional lighting ----- //
  wrap("AmbientLight.prototype.clone", PATCHES_AmbientLight.BASIC.WRAPS.clone);
  wrap("AmbientLight.prototype._onUpdate", PATCHES_AmbientLight.BASIC.WRAPS._onUpdate);
  wrap("AmbientLight.prototype.refreshControl", PATCHES_AmbientLight.BASIC.WRAPS.refreshControl);

  // ----- Penumbra lighting shadows ----- //
  wrap("LightSource.prototype._initialize", PATCHES_LightSource.WEBGL.WRAPS._initialize);
  wrap("LightSource.prototype._createPolygon", PATCHES_LightSource.WEBGL.WRAPS._createPolygon);

  // ----- Shadow visibility testing ----- //
  if ( getSetting(SETTINGS.TEST_VISIBILITY) ) {
    override("DetectionMode.prototype._testLOS", PATCHES_DetectionMode.VISIBILITY.OVERRIDES._testLOS, { perf_mode: libWrapper.PERF_FAST });
    override("DetectionModeBasicSight.prototype._testPoint", PATCHES_DetectionModeBasicSight.VISIBILITY.OVERRIDES._testPoint, { perf_mode: libWrapper.PERF_FAST });
  }

  // ----- Tremor visibility detection ----- //
  override("DetectionModeTremor.prototype._canDetect", PATCHES_DetectionModeTremor.BASIC.OVERRIDES._canDetect, { perf_mode: libWrapper.PERF_FAST });

  // Clear the prior libWrapper shader ids, if any.
  libWrapperShaderIds.length = 0;
}

export function registerAdditions() {
  addClassMethod(ClockwiseSweepPolygon.prototype, "_drawShadows", PATCHES_ClockwiseSweepPolygon.POLYGONS.METHODS._drawShadows);
  addClassMethod(Token.prototype, "getTopLeft", getTopLeftTokenCorner);

  addClassMethod(Tile.prototype, "evPixelCache", PATCHES_Tile.BASIC.GETTERS.getEVPixelCache, { getter: true });

  // For Polygons shadows -- Nothing added

  // For Directional Lighting
  addClassMethod(AmbientLight.prototype, "convertToDirectionalLight", PATCHES_AmbientLight.BASIC.METHODS.convertToDirectionalLight);
  addClassMethod(AmbientLight.prototype, "convertFromDirectionalLight", PATCHES_AmbientLight.BASIC.METHODS.convertFromDirectionalLight);

  // For WebGL shadows
  addClassMethod(RenderedPointSource.prototype, "wallAdded", PATCHES_RenderedPointSource.WEBGL.METHODS.wallAdded);
  addClassMethod(RenderedPointSource.prototype, "wallUpdated", PATCHES_RenderedPointSource.WEBGL.METHODS.wallUpdated);
  addClassMethod(RenderedPointSource.prototype, "wallRemoved", PATCHES_RenderedPointSource.WEBGL.METHODS.wallRemoved);
  addClassMethod(RenderedPointSource.prototype, "bounds", PATCHES_RenderedPointSource.WEBGL.GETTERS.bounds, { getter: true });

  addClassMethod(CanvasVisibility.prototype, "checkLights", PATCHES_CanvasVisibility.WEBGL.METHODS.checkLights);
  addClassMethod(CanvasVisibility.prototype, "cacheLights", PATCHES_CanvasVisibility.WEBGL.METHODS.cacheLights);
  addClassMethod(CanvasVisibility.prototype, "renderTransform", PATCHES_CanvasVisibility.WEBGL.METHODS.renderTransform);
  addClassMethod(CanvasVisibility.prototype, "pointSourcesStates", PATCHES_CanvasVisibility.WEBGL.METHODS.pointSourcesStates);

  // For WebGL shadows -- shadow properties
  addClassMethod(RenderedPointSource.prototype, "EVVisionMask", PATCHES_RenderedPointSource.WEBGL.GETTERS.EVVisionMask, { getter: true });
  addClassMethod(VisionSource.prototype, "EVVisionLOSMask", PATCHES_VisionSource.WEBGL.GETTERS.EVVisionLOSMask, { getter: true });
  addClassMethod(GlobalLightSource.prototype, "EVVisionMask", PATCHES_GlobalLightSource.WEBGL.GETTERS.EVVisionMask, { getter: true });
  addClassMethod(VisionSource.prototype, "EVVisionMask", PATCHES_VisionSource.WEBGL.GETTERS.EVVisionMask, { getter: true });

  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadows", PATCHES_RenderedPointSource.WEBGL.METHODS._initializeEVShadows);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowGeometry", PATCHES_RenderedPointSource.WEBGL.METHODS._initializeEVShadowGeometry);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowMesh", PATCHES_RenderedPointSource.WEBGL.METHODS._initializeEVShadowMesh);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowRenderer", PATCHES_RenderedPointSource.WEBGL.METHODS._initializeEVShadowRenderer);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowMask", PATCHES_RenderedPointSource.WEBGL.METHODS._initializeEVShadowMask);

  addClassMethod(LightSource.prototype, "_initializeEVShadowMesh", PATCHES_LightSource.WEBGL.METHODS._initializeEVShadowMesh);

  addClassMethod(VisionSource.prototype, "_initializeEVShadowGeometry", PATCHES_VisionSource.WEBGL.METHODS._initializeEVShadowGeometry);
  addClassMethod(VisionSource.prototype, "_initializeEVShadowRenderer", PATCHES_VisionSource.WEBGL.METHODS._initializeEVShadowRenderer);
  addClassMethod(VisionSource.prototype, "_initializeEVShadowMask", PATCHES_VisionSource.WEBGL.METHODS._initializeEVShadowMask);

  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadows", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadows);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowGeometry", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowGeometry);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowMesh", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowMesh);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowRenderer", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowRenderer);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowMask", PATCHES_GlobalLightSource.WEBGL.METHODS._initializeEVShadowMask);

  addClassMethod(RenderedPointSource.prototype, "_updateEVShadowData", PATCHES_RenderedPointSource.WEBGL.METHODS._updateEVShadowData);
  addClassMethod(LightSource.prototype, "_updateEVShadowData", PATCHES_LightSource.WEBGL.METHODS._updateEVShadowData);
  addClassMethod(GlobalLightSource.prototype, "_updateEVShadowData", PATCHES_GlobalLightSource.WEBGL.METHODS._updateEVShadowData);

  // For light elevation tooltip
  addClassMethod(AmbientLight.prototype, "_drawTooltip", PATCHES_AmbientLight.BASIC.METHODS._drawTooltip);
  addClassMethod(AmbientLight.prototype, "_getTooltipText", PATCHES_AmbientLight.BASIC.METHODS._getTooltipText);
  addClassMethod(AmbientLight, "_getTextStyle", PATCHES_AmbientLight.BASIC.STATIC_METHODS._getTextStyle);

  // For vision in dim/bright/shadows
  addClassMethod(RenderedPointSource.prototype, "pointInShadow", PATCHES_RenderedPointSource.VISIBILITY.METHODS.pointInShadow);
  addClassMethod(RenderedPointSource.prototype, "targetInShadow", PATCHES_RenderedPointSource.VISIBILITY.METHODS.targetInShadow);
  addClassMethod(VisionSource.prototype, "targetInShadow", PATCHES_VisionSource.VISIBILITY.METHODS.targetInShadow);
  addClassMethod(RenderedPointSource.prototype, "hasWallCollision", PATCHES_RenderedPointSource.VISIBILITY.METHODS.hasWallCollision);
}


/**
 * Deregister shading wrappers.
 * Used when switching shadow algorithms. Deregister all, then re-register needed wrappers.
 */
function deregisterShadowPatches() {
  libWrapperShaderIds.forEach(i => libWrapper.unregister(MODULE_ID, i, false));
}

export async function updateShadowPatches(algorithm, priorAlgorithm) {
  registerShadowPatches(algorithm);

  if ( (!priorAlgorithm && algorithm !== SETTINGS.SHADING.TYPES.WEBGL)
    || priorAlgorithm === SETTINGS.SHADING.TYPES.WEBGL ) await SettingsConfig.reloadConfirm({world: true});
  await canvas.draw();

  if ( algorithm === SETTINGS.SHADING.TYPES.WEBGL ) {
    const sources = [
      ...canvas.effects.lightSources,
      ...canvas.tokens.placeables.map(t => t.vision)
    ];

    for ( const src of sources ) {
      const ev = src[MODULE_ID];
      if ( !ev ) continue;

      ev.wallGeometry?.refreshWalls();
      ev.wallGeometryUnbounded?.refreshWalls();

      if ( ev.shadowMesh ) {
        ev.shadowMesh.shader.uniforms.uTerrainSampler = canvas.elevation._elevationTexture;
        ev.shadowRenderer.update();
      }

      if ( ev.shadowVisionLOSMesh ) {
        ev.shadowVisionLOSMesh.shader.uniforms.uTerrainSampler = canvas.elevation._elevationTexture;
        ev.shadowVisionLOSRenderer.update();
      }
    }
  }
}

export function registerShadowPatches(algorithm) {
  const TYPES = SETTINGS.SHADING.TYPES;
  switch ( algorithm ) {
    case TYPES.NONE: return registerNoShadowPatches();
    case TYPES.POLYGONS: return registerPolygonShadowPatches();
    case TYPES.WEBGL: return registerWebGLShadowPatches();
  }
}

function registerNoShadowPatches() {
  deregisterShadowPatches();
}

function registerPolygonShadowPatches() {
  deregisterShadowPatches();
  shaderWrap("PIXI.LegacyGraphics.prototype.drawShape", PATCHES_PIXI_Graphics.POLYGONS.WRAPS.drawShape, { perf_mode: libWrapper.PERF_FAST });
}

function registerWebGLShadowPatches() {
  deregisterShadowPatches();
  shaderOverride("CanvasVisibility.prototype.refreshVisibility", PATCHES_CanvasVisibility.WEBGL.OVERRIDES.refreshVisibility, { perf_mode: libWrapper.PERF_FAST });
  shaderWrap("CanvasVisibility.prototype._tearDown", PATCHES_CanvasVisibility.WEBGL.WRAPS._tearDown, { perf_mode: libWrapper.PERF_FAST });

  shaderWrap("AdaptiveLightingShader.create", PATCHES_AdaptiveLightingShader.BASIC.STATIC_WRAPS.create);

  shaderWrap("RenderedPointSource.prototype._configure", PATCHES_RenderedPointSource.WEBGL.WRAPS._configure, { perf_mode: libWrapper.PERF_FAST });
  shaderWrap("RenderedPointSource.prototype.destroy", PATCHES_RenderedPointSource.WEBGL.WRAPS.destroy, { perf_mode: libWrapper.PERF_FAST });
}

// NOTE: Simple functions used in additions.

/**
 * Calculate the top left corner location for a token given an assumed center point.
 * Used for automatic elevation determination.
 * @param {number} x    Assumed x center coordinate
 * @param {number} y    Assumed y center coordinate
 * @returns {PIXI.Point}
 */
function getTopLeftTokenCorner(x, y) {
  return new PIXI.Point(x - (this.w * 0.5), y - (this.h * 0.5));
}
