/* globals
canvas,
CONST,
flattenObject,
foundry,
GlobalLightSource,
Hooks,
PIXI,
Wall
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { ShadowMaskWallShader, ShadowWallPointSourceMesh } from "./ShadowMaskShader.js";
import { ShadowTextureRenderer } from "./ShadowTextureRenderer.js";
import { TestShadowShader } from "./TestShadowShader.js";
import { EVQuadMesh } from "./ElevationLayerShader.js";

// NOTE: Ambient Light Hooks

/**
 * Hook the initial ambient light draw to construct shadows.
 * A hook event that fires when a {@link PlaceableObject} is initially drawn.
 * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "drawToken".
 * @event drawObject
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being drawn
 */
export function drawAmbientLightHook(object) {
  const lightSource = object.source;
  if ( !lightSource ) return;

  // TODO: Is drawAmbientLightHook still needed?
}

/**
 * Hook light source shader initialization
 * @param {LightSource} lightSource
 */
function initializeLightSourceShadersHook(lightSource) {
  if ( lightSource instanceof GlobalLightSource ) return;
  const ev = lightSource[MODULE_ID] ??= {};

  // Build the geometry.
  if ( ev.wallGeometry ) ev.wallGeometry.destroy(); // Just in case.
  ev.wallGeometry = new PointSourceShadowWallGeometry(lightSource);

  // Build the shadow mesh.
  const lightPosition = Point3d.fromPointSource(lightSource);
  const shader = ShadowMaskWallShader.create(lightPosition);
  if ( ev.shadowMesh ) ev.shadowMesh.destroy(); // Just in case.
  const mesh = new ShadowWallPointSourceMesh(lightSource, shader);
  ev.shadowMesh = mesh;

  // Build the shadow render texture
  ev.shadowRenderer = new ShadowTextureRenderer(lightSource, mesh);
  ev.shadowRenderer.renderShadowMeshToTexture();

  // For testing, add to the canvas effects
  const shadowShader = TestShadowShader.create(ev.shadowRenderer.renderTexture);
  ev.shadowQuadMesh = new EVQuadMesh(lightSource.object.bounds, shadowShader);

  if ( !canvas.effects.EVshadows ) canvas.effects.EVshadows = canvas.effects.addChild(new PIXI.Container());
  canvas.effects.EVshadows.addChild(ev.shadowQuadMesh);
}


/**
 * Hook lighting refresh to update the source geometry
 * See Placeable.prototype._applyRenderFlags.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags
 */
export function refreshAmbientLightHook(object, flags) {
  const ev = object.source[MODULE_ID];
  if ( !ev ) return;

  if ( flags.refreshPosition || flags.refreshElevation || flags.refreshRadius ) {
    console.log(`EV|refreshAmbientLightHook light ${object.source.x},${object.source.y},${object.source.elevationE} flag: ${object.document.flags.elevatedvision.elevation}`);
    ev.geom?.refreshWalls();
    ev.shadowMesh?.updateLightPosition();
  }

  if ( flags.refreshPosition ) {
    ev.shadowRenderer?.update();
    ev.shadowQuadMesh.updateGeometry(object.bounds);

  } else if ( flags.refreshRadius ) {
    ev.shadowRenderer?.updateSourceRadius();
    ev.shadowQuadMesh.updateGeometry(object.bounds);

  } else if ( flags.refreshElevation ) {
    ev.shadowRenderer?.update();
  }
}

/**
 * A hook event that fires when a {@link PlaceableObject} is destroyed.
 * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "destroyToken".
 * @event destroyObject
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being refreshed
 */
export function destroyAmbientLightHook(object) {
  const ev = object.source[MODULE_ID];
  if ( !ev ) return;

  if ( ev.shadowQuadMesh ) {
    canvas.effects.EVshadows.removeChild(ev.shadowQuadMesh);
    ev.shadowQuadMesh.destroy();
    ev.shadowQuadMesh = undefined;
  }

  if ( ev.shadowRenderer ) {
    ev.shadowRenderer.destroy();
    ev.shadowRenderer = undefined;
  }

  if ( ev.mesh ) {
    ev.mesh.destroy();
    ev.mesh = undefined;
  }

  if ( ev.wallGeometry ) {
    ev.wallGeometry.destroy();
    ev.wallGeometry = undefined;
  }
}

// NOTE: Wall Document Hooks

/**
 * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
 * Substitute the Document name in the hook event to target a specific type, for example "createToken".
 * This hook fires for all connected clients after the creation has been processed.
 *
 * @event createDocument
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
export function createWallHook(wallD, _options, _userId) {
  for ( const src of canvas.effects.lightSources ) {
    const ev = src[MODULE_ID];
    if ( !ev ) continue;
    ev.wallGeometry?.addWall(wallD.object);
    ev.shadowRenderer?.update();
  }
}

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
export function updateWallHook(wallD, data, _options, _userId) {
  const changes = new Set(Object.keys(flattenObject(data)));
  // TODO: Will eventually need to monitor changes for sounds and sight, possibly move.
  // TODO: Need to deal with threshold as well
  const changeFlags = SourceShadowWallGeometry.CHANGE_FLAGS;
  if ( !(changeFlags.WALL_COORDINATES.some(f => changes.has(f))
    || changeFlags.WALL_RESTRICTED.some(f => changes.has(f))) ) return;

  for ( const src of canvas.effects.lightSources ) {
    const ev = src[MODULE_ID];
    if ( !ev ) continue;
    ev.wallGeometry?.updateWall(wallD.object, { changes });
    ev.shadowRenderer?.update();
  }
}

/**
 * A hook event that fires for every Document type after conclusion of an deletion workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "deleteActor".
 * This hook fires for all connected clients after the deletion has been processed.
 *
 * @event deleteDocument
 * @category Document
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
export function deleteWallHook(wallD, _options, _userId) {
  for ( const src of canvas.effects.lightSources ) {
    const ev = src[MODULE_ID];
    if ( !ev ) continue;
    ev.wallGeometry.removeWall(wallD.id);
    ev.shadowRenderer?.update();
  }
}

/**
 * Set of possible relevant wall changes to use in the default case.
 * We test for open doors, so don't need those changes here.
 * @type {Set<string>}
 */
const DEFAULT_WALL_CHANGES = new Set(["c", "light", "sight", "sound", "move"]);

export class SourceShadowWallGeometry extends PIXI.Geometry {

  /**
   * Number of pixels to extend walls, to ensure overlapping shadows for connected walls.
   * @type {number}
   */
  static WALL_OFFSET_PIXELS = 2;

  /**
   * Changes to monitor in the wall data that indicate a relevant change.
   */
  static CHANGE_FLAGS = {
    WALL_COORDINATES: [
      "c",
      "flags.wall-height.top",
      "flags.wall-height.bottom",
      "flags.elevatedvision.elevation.top",
      "flags.elevatedvision.elevation.bottom"
    ],

    WALL_RESTRICTED: [
      "sight",
      "move",
      "light",
      "sound"
    ]
  };

  /**
   * Track the triangle index for each wall used by this source.
   * @type {Map<string, number>} Wall id and the index
   */
  _triWallMap = new Map();

  /** @type {PointSource} */
  source;

  /** @type {sourceType} */
  sourceType = "light";

  constructor(source, walls) {
    super();
    this.source = source;
    this.sourceType = source.constructor.sourceType;

    walls ??= canvas.walls.placeables;
    this.constructWallGeometry(walls);
  }

  // TODO: Should this be a stored value? Makes it more complicated, but...
  get hasLimitedWalls() {
    const dat = this.getBuffer("aLimitedWall").data;
    return dat.some(x => x);
  }

  constructWallGeometry(walls) {
    this._triWallMap.clear();

    // Default is to draw light --> wallCorner1 --> wallCorner2.
    // Assumed that light is passed as uniform.
    // Attributes used to pass needed wall data to each vertex.
    const indices = [];
    const aWallCorner1 = [];
    const aWallCorner2 = [];
    const aLimitedWall = [];

    let triNumber = 0;
    const nWalls = walls.length;
    for ( let i = 0; i < nWalls; i += 1 ) {
      const wall = walls[i];
      if ( !this._includeWall(wall) ) continue;
      const wallCoords = this._wallCornerCoordinates(wall);

      // TODO: Instanced attributes.
      // For now, must repeat the vertices three times.
      // Should be possible to use instanced attributes to avoid this. (see PIXI.Attribute)
      // Unclear whether that would be supported using Foundry rendering options.
      const corner1 = [wallCoords.corner1.x, wallCoords.corner1.y, wallCoords.topZ];
      const corner2 = [wallCoords.corner2.x, wallCoords.corner2.y, wallCoords.bottomZ];
      aWallCorner1.push(...corner1, ...corner1, ...corner1);
      aWallCorner2.push(...corner2, ...corner2, ...corner2);

      const ltd = this.isLimited(wall);
      aLimitedWall.push(ltd, ltd, ltd);

      const idx = triNumber * 3;
      indices.push(idx, idx + 1, idx + 2);

      // Track where this wall is in the attribute arrays for future updates.
      this._triWallMap.set(wall.id, triNumber);
      triNumber += 1;
    }

    // TODO: Should this or a subclass set interleave to true?
    this.addIndex(indices);
    this.addAttribute("aWallCorner1", aWallCorner1, 3);
    this.addAttribute("aWallCorner2", aWallCorner2, 3);
    this.addAttribute("aLimitedWall", aLimitedWall, 1); // TODO: Make this something other than PIXI.TYPES.FLOAT
  }

  /**
   * Is the wall limited with respect to this light source?
   * @param {Wall} wall
   * @returns {boolean}
   */
  isLimited(wall) {
    return wall.document[this.sourceType] === CONST.WALL_SENSE_TYPES.LIMITED;
  }

  /**
   * Should this wall be included in the geometry for this source shadow?
   * @param {Wall} wall
   * @returns {boolean}   True if wall should be included
   */
  _includeWall(wall) {
    if ( wall.isDoor && wall.isOpen ) return false;

    const minCanvasE = canvas.elevation?.minElevation ?? canvas.scene.getFlag(MODULE_ID, "elevationmin") ?? 0;
    const topZ = Math.min(wall.topZ, this.source.elevationZ);
    const bottomZ = Math.max(wall.bottomZ, minCanvasE);
    if ( topZ <= bottomZ ) return false; // Wall is above or below the viewing box.
    return true;
  }

  /**
   * Retrieve wall endpoint data for a corner.
   * A is top, B is bottom
   * @param {Wall} wall
   * @returns { corner1: {PIXI.Point}, corner2: {PIXI.Point}, topZ: {number}, bottomZ: {number} }
   */
  _wallCornerCoordinates(wall) {
    const A = new PIXI.Point(wall.A.x, wall.A.y);
    const B = new PIXI.Point(wall.B.x, wall.B.y);
    const ABDist = PIXI.Point.distanceBetween(A, B);

    // Slightly extend wall to ensure connected walls do not have gaps in shadows.
    const adjA = B.towardsPoint(A, ABDist + this.constructor.WALL_OFFSET_PIXELS);
    const adjB = A.towardsPoint(B, ABDist + this.constructor.WALL_OFFSET_PIXELS);
    const topZ = Math.min(wall.topZ + this.constructor.WALL_OFFSET_PIXELS, Number.MAX_SAFE_INTEGER);
    const bottomZ = Math.max(wall.bottomZ - this.constructor.WALL_OFFSET_PIXELS, Number.MIN_SAFE_INTEGER);

    const out = {
      corner1: adjA,
      corner2: adjB,
      topZ,
      bottomZ
    };

    // Round b/c points may be adjusted.
    out.corner1.roundDecimals();
    out.corner2.roundDecimals();

    return out;
  }

  // ----- Wall updates ----- //
  /**
   * Add single element (chunk) of data to a buffer and return a new buffer.
   *
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number[]} data       New data chunk to add
   * @returns {TypedArray} New typed array with one additional element at end
   */
  static addToBuffer(buffer, data) {
    // TODO: Remove when done testing for speed.
    if ( (buffer.length % data.length) !== 0 ) {
      console.error(`${MODULE_ID}|overwriteBufferAt has incorrect data length.`);
      return buffer;
    }

    const newBufferData = new buffer.constructor(buffer.length + data.length);
    newBufferData.set(buffer, 0);
    newBufferData.set(data, buffer.length);
    return newBufferData;
  }

  /**
   * Add single element of a given size to a buffer and return a new buffer.
   * @param {TypedArray} buffer       Typed array to copy and modify
   * @param {number[]} data           New data to add
   * @param {number} idxToOverwrite   Index of the element.
   *   If there are 10 elements, and data is length 3, then buffer should be length 30.
   * @returns {TypedArray} New typed array with one additional element at end
   */
  static overwriteBufferAt(buffer, data, idxToOverwrite) {
    // TODO: Remove when done testing for speed.
    if ( (buffer.length % data.length) !== 0 || (idxToOverwrite * data.length) > buffer.length ) {
      console.error(`${MODULE_ID}|overwriteBufferAt has incorrect data length.`);
      return buffer;
    }

    buffer.set(data, data.length * idxToOverwrite);
    return buffer;
  }

  /**
   * Remove single element of a given size from a buffer and return a new buffer of the remainder.
   * @param {TypedArray} buffer   Typed array to copy and modify
   * @param {number} size         Size of a given element.
   * @param {number} idxToRemove  Element index to remove. Will be adjusted by size.
   *    If there are 10 elements, and siz is length 3, then buffer should be length 30.
   * @returns {TypedArray} New typed array with one less element
   */
  static removeFromBuffer(buffer, size, idxToRemove) {
    // TODO: Remove when done testing for speed.
    if ( (buffer.length % size) !== 0 || (idxToRemove * size) > buffer.length ) {
      console.error(`${MODULE_ID}|overwriteBufferAt has incorrect data length.`);
      return buffer;
    }

    const newLn = Math.max(buffer.length - size, 0);
    const newBufferData = new buffer.constructor(newLn);
    if ( !newLn ) return newBufferData;

    newBufferData.set(buffer.slice(0, idxToRemove * size), 0);
    newBufferData.set(buffer.slice((idxToRemove * size) + size), idxToRemove * size);
    return newBufferData;
  }

  /**
   * Add a wall to this geometry.
   * @param {Wall} wall   Wall to add
   * @param {boolean} [update=true]  If false, buffer will not be flagged for update
   */
  addWall(wall, update = true) {
    if ( this._triWallMap.has(wall.id) ) return;
    if ( !this._includeWall(wall) ) return;

    const wallCoords = this._wallCornerCoordinates(wall);
    const idxToAdd = this._triWallMap.size;

    // First wall corner
    const coords1 = [wallCoords.corner1.x, wallCoords.corner1.y, wallCoords.topZ];
    const data1 = [...coords1, ...coords1, ...coords1];
    const buffer1 = this.getBuffer("aWallCorner1");
    buffer1.data = this.constructor.addToBuffer(buffer1.data, data1);

    // Second wall corner
    const coords2 = [wallCoords.corner2.x, wallCoords.corner2.y, wallCoords.bottomZ];
    const data2 = [...coords2, ...coords2, ...coords2];
    const buffer2 = this.getBuffer("aWallCorner2");
    buffer2.data = this.constructor.addToBuffer(buffer2.data, data2);

    // Limited wall indicator
    const ltd = [this.isLimited(wall)];
    const data3 = [ltd, ltd, ltd];
    const buffer3 = this.getBuffer("aLimitedWall");
    buffer3.data = this.constructor.addToBuffer(buffer3.data, data3);

    // Index
    const idx = idxToAdd * 3;
    const dataIdx = [idx, idx + 1, idx + 2];
    this.indexBuffer.data = this.constructor.addToBuffer(this.indexBuffer.data, dataIdx);

    // Add the wall id as the next triangle object to the tracker.
    this._triWallMap.set(wall.id, idxToAdd);

    // Flag the updated buffers for uploading to the GPU.
    if ( update ) this.update();
  }

  updateWall(wall, { update = true, changes = DEFAULT_WALL_CHANGES } = {}) {
    if ( !this._triWallMap.has(wall.id) ) return this.addWall(wall, update);
    if ( !this._includeWall(wall) ) return this.removeWall(wall.id, update);

    const idxToUpdate = this._triWallMap.get(wall.id);

    // Wall endpoint coordinates
    if ( SourceShadowWallGeometry.CHANGE_FLAGS.WALL_COORDINATES.some(f => changes.has(f)) ) {
      const wallCoords = this._wallCornerCoordinates(wall);

      // First wall corner
      const coords1 = [wallCoords.corner1.x, wallCoords.corner1.y, wallCoords.topZ];
      const data1 = [...coords1, ...coords1, ...coords1];
      const buffer1 = this.getBuffer("aWallCorner1");
      buffer1.data = this.constructor.overwriteBufferAt(buffer1.data, data1, idxToUpdate);

      // Second wall corner
      const coords2 = [wallCoords.corner2.x, wallCoords.corner2.y, wallCoords.bottomZ];
      const data2 = [...coords2, ...coords2, ...coords2];
      const buffer2 = this.getBuffer("aWallCorner2");
      buffer2.data = this.constructor.overwriteBufferAt(buffer2.data, data2, idxToUpdate);

      if ( update ) {
        buffer1.update(buffer1.data);
        buffer2.update(buffer2.data);
      }
    }

    // Limited wall indicator
    if ( changes.has(this.sourceType) ) {
      const ltd = [this.isLimited(wall)];
      const data3 = [ltd, ltd, ltd];
      const buffer3 = this.getBuffer("aLimitedWall");
      buffer3.data = this.constructor.overwriteBufferAt(buffer3.data, data3, idxToUpdate);
      if ( update ) buffer3.update(buffer3.data);
    }

    // Don't need to update the index
  }

  /**
   * Remove a wall from this geometry.
   * @param {string} id   Wall id (b/c that is what the remove hook uses)
   */
  removeWall(id, update = true) {
    if ( id instanceof Wall ) id = id.id;
    if ( !this._triWallMap.has(id) ) return;

    const idxToRemove = this._triWallMap.get(id);

    for ( const attr of ["aWallCorner1", "aWallCorner2", "aLimitedWall"] ) {
      const size = this.getAttribute(attr).size * 3;
      const buffer = this.getBuffer(attr);
      buffer.data = this.constructor.removeFromBuffer(buffer.data, size, idxToRemove);
    }
    const size = 3;
    this.indexBuffer.data = this.constructor.removeFromBuffer(this.indexBuffer.data, size, idxToRemove);

    // Remove the wall from the tracker and decrement other wall indices accordingly.
    this._triWallMap.delete(id);
    const fn = (value, key, map) => { if ( value > idxToRemove ) map.set(key, value - 1); };
    this._triWallMap.forEach(fn);

    // Currently, the index buffer is consecutive.
    this.indexBuffer.data = this.indexBuffer.data.map((value, index) => index);

    // Flag the updated buffers for uploading to the GPU.
    if ( update ) this.update();
  }

  /**
   * Check all the walls in the scene b/c the source changed position or was otherwise modified.
   * @param {Wall[]} [walls]
   */
  refreshWalls(walls) {
    walls ??= canvas.walls.placeables;
    const changes = new Set();
    const opts = { changes, update: false };
    walls.forEach(w => this.updateWall(w, opts));
    this.update();
  }

  update() {
    // Flag each buffer for updating.
    // Assumes that addWall, updateWall, or removeWall updated the local buffer previously.
    for ( const attr of ["aWallCorner1", "aWallCorner2", "aLimitedWall"] ) {
      const buffer = this.getBuffer(attr);
      buffer.update(buffer.data);
    }
    this.indexBuffer.update(this.indexBuffer.data);
  }
}


export class PointSourceShadowWallGeometry extends SourceShadowWallGeometry {


  _includeWall(wall) {
    if ( !super._includeWall(wall) ) return false;

    // Wall cannot be collinear to the light.
    const orientWall = foundry.utils.orient2dFast(wall.A, wall.B, this.source);
    if ( orientWall.almostEqual(0) ) return false;

    // Wall must be within the light radius.
    const bounds = this.source.bounds ?? this.source.object.bounds ?? canvas.dimensions.rect;
    if ( !bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

    return true;
  }

}

export class SizedSourceShadowWallGeometry extends PointSourceShadowWallGeometry {
  // Light has defined size.

}

export class DirectionalSourceShadowWallGeometry extends SourceShadowWallGeometry {

  /**
   * Direction of the light is from center of the canvas toward the light position and elevation.
   * @type {Point3d}
   */
  get sourceDirection() {
    const center = canvas.dimensions.sceneRect.center;
    const srcPosition = new Point3d(this.source.x, this.source.y, this.source.elevationZ);
    return srcPosition.subtract(center).normalize();
  }


  _includeWall(wall) {
    // Wall must not be the same (2d) direction as the source
    const A = new PIXI.Point(wall.A.x, wall.A.y);
    const orientWall = foundry.utils.orient2dFast(A, wall.B, A.add(this.sourceDirection));
    if ( orientWall.almostEqual(0) ) return false;

    return true;
  }
}

Hooks.on("drawAmbientLight", drawAmbientLightHook);
Hooks.on("refreshAmbientLight", refreshAmbientLightHook);
Hooks.on("destroyAmbientLight", destroyAmbientLightHook);
Hooks.on("createWall", createWallHook);
Hooks.on("updateWall", updateWallHook);
Hooks.on("deleteWall", deleteWallHook);
Hooks.on("initializeLightSourceShaders", initializeLightSourceShadersHook);
