/* globals
AmbientLight,
canvas,
CanvasVisibility,
ClockwiseSweepPolygon,
GlobalLightSource,
libWrapper,
LightingLayer,
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

import {
  defaultOptionsAmbientSoundConfig,
  getDataTileConfig,
  _onChangeInputTileConfig
} from "./renderConfig.js";

import {
  cloneToken
} from "./tokens.js";

import {
  drawShapePIXIGraphics,
  refreshVisibilityCanvasVisibility,
  checkLightsCanvasVisibility,
  _tearDownCanvasVisibility,
  cacheLightsCanvasVisibility } from "./vision.js";

import {
  _computeClockwiseSweepPolygon,
  _drawShadowsClockwiseSweepPolygon,
  initializeClockwiseSweepPolygon
} from "./clockwise_sweep.js";

import { getEVPixelCacheTile } from "./tiles.js";

import { _onMouseMoveCanvas } from "./ElevationLayer.js";

import { createAdaptiveLightingShader } from "./glsl/patch_lighting_shaders.js";

import {
  _configureRenderedPointSource,
  destroyRenderedPointSource,
  wallAddedRenderedPointSource,
  wallUpdatedRenderedPointSource,
  wallRemovedRenderedPointSource,
  boundsRenderedPointSource,

  EVVisionMaskRenderedPointSource,
  EVVisionLOSMaskVisionSource,
  EVVisionMaskGlobalLightSource,
  EVVisionMaskVisionSource,

  _initializeEVShadowsRenderedPointSource,
  _initializeEVShadowGeometryRenderedPointSource,
  _initializeEVShadowTextureRenderedPointSource,
  _initializeEVShadowMaskRenderedPointSource,

  _initializeEVShadowGeometryVisionSource,
  _initializeEVShadowTextureVisionSource,
  _initializeEVShadowMaskVisionSource,

  _initializeEVShadowsGlobalLightSource,
  _initializeEVShadowGeometryGlobalLightSource,
  _initializeEVShadowTextureGlobalLightSource,
  _initializeEVShadowMaskGlobalLightSource,

  _updateEVShadowDataRenderedPointSource,
  _updateEVShadowDataVisionSource,
  _updateEVShadowDataGlobalLightSource } from "./shadow_hooks.js";

import {
  _drawAmbientLight,
  _drawTooltipAmbientLight,
  _getTooltipTextAmbientLight,
  _getTextStyleAmbientLight,
  refreshControlAmbientLight } from "./lighting_elevation_tooltip.js";

import {
  convertToDirectionalLightAmbientLight,
  convertFromDirectionalLightAmbientLight,
  cloneAmbientLight,
  _onUpdateAmbientLight } from "./directional_lights.js";


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

function mixed(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.MIXED, options);
}

function override(method, fn, options = {}) {
  return libWrapper.register(MODULE_ID, method, fn, libWrapper.OVERRIDE, options);
}

/**
 * Helper to add a method to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 */
function addClassMethod(cl, name, fn) {
  Object.defineProperty(cl, name, {
    value: fn,
    writable: true,
    configurable: true
  });
}

/**
 * Helper to add a getter to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 */
function addClassGetter(cl, name, fn) {
  if ( !Object.hasOwn(cl, name) ) {
    Object.defineProperty(cl, name, {
      get: fn,
      enumerable: false,
      configurable: true
    });
  }
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
  wrap("Canvas.prototype._onMouseMove", _onMouseMoveCanvas, { perf_mode: libWrapper.PERF_FAST });

  // ----- Locating edges that create shadows in the LOS ----- //
  wrap("ClockwiseSweepPolygon.prototype._compute", _computeClockwiseSweepPolygon, { perf_mode: libWrapper.PERF_FAST });

  // ----- Token animation and elevation change ---- //
  wrap("Token.prototype.clone", cloneToken, { perf_mode: libWrapper.PERF_FAST });

  // ----- Application rendering configurations ----- //
  wrap("AmbientSoundConfig.defaultOptions", defaultOptionsAmbientSoundConfig);
  wrap("TileConfig.prototype.getData", getDataTileConfig);
  wrap("TileConfig.prototype._onChangeInput", _onChangeInputTileConfig);

  // ----- Clockwise sweep enhancements ----- //
  if ( getSetting(SETTINGS.CLOCKWISE_SWEEP) ) {
    wrap("ClockwiseSweepPolygon.prototype.initialize", initializeClockwiseSweepPolygon, { perf_mode: libWrapper.PERF_FAST });
  }

  // ----- Lighting elevation tooltip ----- //
  wrap("AmbientLight.prototype._draw", _drawAmbientLight);

  // ----- Directional lighting ----- //
  wrap("AmbientLight.prototype.clone", cloneAmbientLight);
  wrap("AmbientLight.prototype._onUpdate", _onUpdateAmbientLight);
  wrap("AmbientLight.prototype.refreshControl", refreshControlAmbientLight);

  // Clear the prior libWrapper shader ids, if any.
  libWrapperShaderIds.length = 0;
}

export function registerAdditions() {
  addClassMethod(ClockwiseSweepPolygon.prototype, "_drawShadows", _drawShadowsClockwiseSweepPolygon);
  addClassMethod(Token.prototype, "getTopLeft", getTopLeftTokenCorner);

  addClassGetter(Tile.prototype, "evPixelCache", getEVPixelCacheTile);
  addClassMethod(Tile.prototype, "_evPixelCache", undefined);

  // For Polygons shadows -- Nothing added

  // For Directional Lighting
  addClassMethod(AmbientLight.prototype, "convertToDirectionalLight", convertToDirectionalLightAmbientLight);
  addClassMethod(AmbientLight.prototype, "convertFromDirectionalLight", convertFromDirectionalLightAmbientLight);

  // For WebGL shadows
  addClassMethod(RenderedPointSource.prototype, "wallAdded", wallAddedRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "wallUpdated", wallUpdatedRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "wallRemoved", wallRemovedRenderedPointSource);
  addClassGetter(RenderedPointSource.prototype, "bounds", boundsRenderedPointSource);

  addClassMethod(CanvasVisibility.prototype, "checkLights", checkLightsCanvasVisibility);
  addClassMethod(CanvasVisibility.prototype, "cacheLights", cacheLightsCanvasVisibility);
  addClassMethod(CanvasVisibility.prototype, "renderTransform", new PIXI.Matrix());
  addClassMethod(CanvasVisibility.prototype, "pointSourcesStates", new Map());

  // For WebGL shadows -- shadow properties
  addClassGetter(RenderedPointSource.prototype, "EVVisionMask", EVVisionMaskRenderedPointSource);
  addClassGetter(VisionSource.prototype, "EVVisionLOSMask", EVVisionLOSMaskVisionSource);
  addClassGetter(GlobalLightSource.prototype, "EVVisionMask", EVVisionMaskGlobalLightSource);
  addClassGetter(VisionSource.prototype, "EVVisionMask", EVVisionMaskVisionSource);

  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadows", _initializeEVShadowsRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowGeometry", _initializeEVShadowGeometryRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowTexture", _initializeEVShadowTextureRenderedPointSource);
  addClassMethod(RenderedPointSource.prototype, "_initializeEVShadowMask", _initializeEVShadowMaskRenderedPointSource);

  addClassMethod(VisionSource.prototype, "_initializeEVShadowGeometry", _initializeEVShadowGeometryVisionSource);
  addClassMethod(VisionSource.prototype, "_initializeEVShadowTexture", _initializeEVShadowTextureVisionSource);
  addClassMethod(VisionSource.prototype, "_initializeEVShadowMask", _initializeEVShadowMaskVisionSource);

  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadows", _initializeEVShadowsGlobalLightSource);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowGeometry", _initializeEVShadowGeometryGlobalLightSource);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowTexture", _initializeEVShadowTextureGlobalLightSource);
  addClassMethod(GlobalLightSource.prototype, "_initializeEVShadowMask", _initializeEVShadowMaskGlobalLightSource);

  addClassMethod(RenderedPointSource.prototype, "_updateEVShadowData", _updateEVShadowDataRenderedPointSource);
  addClassMethod(VisionSource.prototype, "_updateEVShadowData", _updateEVShadowDataVisionSource);
  addClassMethod(GlobalLightSource.prototype, "_updateEVShadowData", _updateEVShadowDataGlobalLightSource);

  // For light elevation tooltip
  addClassMethod(AmbientLight.prototype, "_drawTooltip", _drawTooltipAmbientLight);
  addClassMethod(AmbientLight.prototype, "_getTooltipText", _getTooltipTextAmbientLight);
  addClassMethod(AmbientLight.prototype, "_getTextStyle", _getTextStyleAmbientLight);
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
  shaderWrap("PIXI.LegacyGraphics.prototype.drawShape", drawShapePIXIGraphics, { perf_mode: libWrapper.PERF_FAST });
}

function registerWebGLShadowPatches() {
  deregisterShadowPatches();
  shaderOverride("CanvasVisibility.prototype.refreshVisibility", refreshVisibilityCanvasVisibility, { perf_mode: libWrapper.PERF_FAST });
  shaderWrap("CanvasVisibility.prototype._tearDown", _tearDownCanvasVisibility, { perf_mode: libWrapper.PERF_FAST });

  shaderWrap("AdaptiveLightingShader.create", createAdaptiveLightingShader);

  shaderWrap("RenderedPointSource.prototype._configure", _configureRenderedPointSource, { perf_mode: libWrapper.PERF_FAST });
  shaderWrap("RenderedPointSource.prototype.destroy", destroyRenderedPointSource, { perf_mode: libWrapper.PERF_FAST });
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
