<template>
  <div id="map-container">
    <div id="map"></div>

    <!-- 左上角控制面板 -->
    <div class="control-panel" :class="{ minimized: isPanelMinimized }">
      <!-- 面板頂部標題列與最小化按鈕 -->
      <div class="panel-header">
        <span class="header-title">⚙️ 地圖控制</span>
        <button class="minimize-btn" @click="isPanelMinimized = !isPanelMinimized" :title="isPanelMinimized ? '展開面板' : '最小化面板'">
          {{ isPanelMinimized ? '➕ 展開' : '➖ 最小化' }}
        </button>
      </div>

      <!-- 面板主要內容（最小化時隱藏） -->
      <div v-show="!isPanelMinimized" class="panel-body">
        <!-- 字體大小控制 -->
        <div class="panel-group">
          <span class="group-title">🔤 文字大小</span>
          <div class="button-row">
            <button @click="changeFontSize(1.15)">🔤 字體 +</button>
            <button @click="changeFontSize(0.85)">🔤 字體 -</button>
          </div>
        </div>

        <!-- 地圖主題控制 -->
        <div class="panel-group">
          <span class="group-title">🎨 地圖主題</span>
          <div class="button-row">
            <button @click="toggleTheme('dark')" :class="{ active: currentTheme === 'dark' }">🌙 暗黑模式</button>
            <button @click="toggleTheme('light')" :class="{ active: currentTheme === 'light' }">☀️ 淺色模式</button>
          </div>
        </div>

        <!-- 各 Layer 獨立開關與顏色監控 -->
        <div class="panel-group layer-color-group">
          <span class="group-title">🎨 圖層開關與顏色獨立監控</span>
          <input 
            type="text" 
            v-model="layerSearchKeyword" 
            placeholder="搜尋 layer id..." 
            class="layer-search-input"
          />
          
          <!-- 一鍵全 On / 全 Off 按鈕列 -->
          <div class="button-row" style="margin-bottom: 6px;">
            <button @click="setAllLayersVisibility(true)">✅ 一鍵全 ON</button>
            <button @click="setAllLayersVisibility(false)">❌ 一鍵全 OFF</button>
          </div>

          <div class="layer-color-scroll">
            <div v-for="(conf, layerId) in filteredLayerColors" :key="layerId" class="layer-color-item">
              <div class="layer-item-header">
                <!-- 獨立 Layer On/Off 開關 -->
                <label class="layer-switch-label" :title="layerId">
                  <input 
                    type="checkbox" 
                    v-model="conf.visible" 
                    @change="toggleLayerVisibility(layerId, conf.visible)"
                  />
                  <span class="layer-id-text">{{ layerId }}</span>
                </label>
              </div>
              
              <!-- 顏色選擇器（支援 line-color, text-color, fill-color, circle-color 等） -->
              <div class="color-pickers" v-if="Object.keys(conf.colors).length > 0">
                <template v-for="(colorVal, propName) in conf.colors" :key="propName">
                  <label class="color-picker-label">
                    <small>{{ propName.replace('-color', '') }}</small>
                    <input 
                      type="color" 
                      v-model="conf.colors[propName]" 
                      @input="updateLayerColor(layerId, propName, conf.colors[propName])"
                    />
                  </label>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- 當前 Zoom Level 顯示 -->
        <div class="panel-group">
          <span class="group-title">🔍 地圖層級</span>
          <div class="zoom-display">Zoom: <strong>{{ currentZoom }}</strong></div>
        </div>

        <!-- Debug 工具開關群組 -->
        <div class="panel-group">
          <span class="group-title">🛠️ Debug 工具</span>
          <button class="force-refresh-btn" @click="forceReloadMap">🔄 強制刷新所有圖磚 (清快取)</button>

          <label class="checkbox-label" style="margin-top: 6px;">
            <input type="checkbox" v-model="showTileGridDebug" @change="updateTileGridOverlay" />
            顯示 Tile 邊界與 PBF 網址
          </label>
        </div>
      </div>
    </div>

    <!-- 右下角指南針旋轉按鈕 -->
    <button class="compass-btn" @click="toggleCompass">
      {{ isCompassActive ? '🧭 關閉追蹤方向' : '🧭 隨方向旋轉' }}
    </button>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';

// 引入本地 JSON 檔案
import basemapStyleRaw from './assets/config/basemap-style.json';
import layerStyleRaw from './assets/config/layer-style.json';

let map = null;
let glLayer = null;
let watchId = null;
let tileDebugLayerGroup = null;

const isPanelMinimized = ref(false);
const isCompassActive = ref(false);
const currentTheme = ref('light');
const fontScaleMultiplier = ref(1.0);
const currentZoom = ref(15);

const showTileGridDebug = ref(false);

const layerSearchKeyword = ref('');
const layerColorConfigs = reactive({});

const LANG = 'tc';
const isProd = import.meta.env.PROD;
const CSDI_HOST = isProd 
  ? 'https://mapapi.geodata.gov.hk/gs/api' 
  : `${window.location.origin}/csdi-api`;

const BASEMAP_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf`;
const LABEL_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/{z}/{y}/{x}.pbf`;

let originalFontSizes = {};
let originalColors = {};

const filteredLayerColors = computed(() => {
  const keywordStr = layerSearchKeyword.value.trim().toLowerCase();
  if (!keywordStr) return layerColorConfigs;

  // 支援空格分割，將輸入拆解為多個關鍵字陣列（例如 "mtr 2" -> ["mtr", "2"]）
  const keywords = keywordStr.split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return layerColorConfigs;

  const filtered = {};
  Object.keys(layerColorConfigs).forEach((layerId) => {
    const lowerLayerId = layerId.toLowerCase();
    // 檢查圖層 ID 是否同時包含所有輸入的關鍵字 (AND 邏輯)
    const isMatch = keywords.every(kw => lowerLayerId.includes(kw));
    
    if (isMatch) {
      filtered[layerId] = layerColorConfigs[layerId];
    }
  });
  return filtered;
});

const rgbToHex = (rgbStr) => {
  if (!rgbStr || typeof rgbStr !== 'string') return '#000000';
  if (rgbStr.startsWith('#')) return rgbStr;
  const match = rgbStr.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/);
  if (!match) return '#000000';
  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
};

// 切換單一圖層的 On/Off 顯示狀態
const toggleLayerVisibility = (layerId, isVisible) => {
  const maplibreMap = glLayer?.getMaplibreMap?.();
  if (!maplibreMap) return;

  const visibilityVal = isVisible ? 'visible' : 'none';
  
  const matchGroup = layerId.match(/TSPTLINE|TSPTPOLY|Road|Building|Water/i);
  const groupKey = matchGroup ? matchGroup[0].toUpperCase() : null;

  Object.keys(layerColorConfigs).forEach((targetLayerId) => {
    let shouldUpdate = false;
    if (targetLayerId === layerId) {
      shouldUpdate = true;
    } else if (groupKey && targetLayerId.toUpperCase().includes(groupKey)) {
      shouldUpdate = true;
      layerColorConfigs[targetLayerId].visible = isVisible;
    }

    if (shouldUpdate) {
      try {
        maplibreMap.setLayoutProperty(targetLayerId, 'visibility', visibilityVal);
      } catch (e) {
        console.warn(`切換圖層 ${targetLayerId} 顯示狀態失敗:`, e);
      }
    }
  });
};

// 一鍵全 On / 全 Off 功能函數
const setAllLayersVisibility = (isVisible) => {
  const maplibreMap = glLayer?.getMaplibreMap?.();
  if (!maplibreMap) return;

  const visibilityVal = isVisible ? 'visible' : 'none';
  const targetIds = Object.keys(filteredLayerColors.value);

  targetIds.forEach((layerId) => {
    layerColorConfigs[layerId].visible = isVisible;
    try {
      maplibreMap.setLayoutProperty(layerId, 'visibility', visibilityVal);
    } catch (e) {
      console.warn(`批次設定圖層 ${layerId} 顯隱失敗:`, e);
    }
  });
};

// 更新圖層顏色（同時支援 paint 與 layout 屬性如 text-color 等）
const updateLayerColor = (layerId, propName, colorValue) => {
  const maplibreMap = glLayer?.getMaplibreMap?.();
  if (!maplibreMap) return;

  const matchGroup = layerId.match(/TSPTLINE|TSPTPOLY|Road|Building|Water/i);
  const groupKey = matchGroup ? matchGroup[0].toUpperCase() : null;

  Object.keys(layerColorConfigs).forEach((targetLayerId) => {
    let shouldUpdate = false;

    if (targetLayerId === layerId) {
      shouldUpdate = true;
    } else if (groupKey && targetLayerId.toUpperCase().includes(groupKey)) {
      if (layerColorConfigs[targetLayerId].colors[propName] !== undefined) {
        shouldUpdate = true;
        layerColorConfigs[targetLayerId].colors[propName] = colorValue;
      }
    }

    if (shouldUpdate) {
      try {
        // 判斷屬性是屬於 layout 還是 paint
        if (propName.includes('text-') || propName.includes('icon-')) {
          maplibreMap.setLayoutProperty(targetLayerId, propName, colorValue);
        } else {
          maplibreMap.setPaintProperty(targetLayerId, propName, colorValue);
        }
      } catch (e) {
        console.warn(`更新圖層 ${targetLayerId} 的 ${propName} 失敗:`, e);
      }
    }
  });
};

const changeFontSize = (factor) => {
  const maplibreMap = glLayer?.getMaplibreMap?.();
  if (!maplibreMap) return;

  fontScaleMultiplier.value *= factor;
  const style = maplibreMap.getStyle();
  if (!style || !style.layers) return;

  style.layers.forEach((layer) => {
    if (layer.layout && layer.layout['text-size']) {
      const originalSize = originalFontSizes[layer.id];
      if (!originalSize) return;

      if (typeof originalSize === 'number') {
        maplibreMap.setLayoutProperty(layer.id, 'text-size', originalSize * fontScaleMultiplier.value);
      } else if (Array.isArray(originalSize)) {
        const newSize = originalSize.map((item) =>
          typeof item === 'number' ? item * fontScaleMultiplier.value : item
        );
        maplibreMap.setLayoutProperty(layer.id, 'text-size', newSize);
      }
    }
  });
};

const toggleTheme = (mode) => {
  const maplibreMap = glLayer?.getMaplibreMap?.();
  if (!maplibreMap) return;

  currentTheme.value = mode;
  const style = maplibreMap.getStyle();
  if (!style || !style.layers) return;

  style.layers.forEach((layer) => {
    const layerId = layer.id;
    if (layerId.includes('label') || layerId.includes('text') || layerId.includes('Anno')) return;

    if (mode === 'dark') {
      if (layer.type === 'background') {
        maplibreMap.setPaintProperty(layerId, 'background-color', '#12161f');
      } else if (layer.type === 'fill') {
        if (layerId.includes('water')) {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#0e2a47');
        } else if (layerId.includes('park') || layerId.includes('green')) {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#163321');
        } else if (layerId.includes('building')) {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#252d3a');
        } else {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#1c2333');
        }
      } else if (layer.type === 'line') {
        maplibreMap.setPaintProperty(layerId, 'line-color', '#2c374e');
      }
    } else {
      const orig = originalColors[layerId];
      if (orig) {
        Object.keys(orig).forEach((prop) => {
          if (prop.includes('color')) {
            maplibreMap.setPaintProperty(layerId, prop, orig[prop]);
          }
        });
      }
    }
  });
};

const forceReloadMap = () => {
  const maplibreMap = glLayer?.getMaplibreMap?.();
  if (!maplibreMap) return;

  const newBust = Date.now();
  const style = maplibreMap.getStyle();
  if (style && style.sources) {
    Object.keys(style.sources).forEach((srcKey) => {
      if (style.sources[srcKey].tiles) {
        style.sources[srcKey].tiles = style.sources[srcKey].tiles.map(url => {
          const cleanUrl = url.split('?')[0];
          return `${cleanUrl}?v=${newBust}`;
        });
      }
    });
    maplibreMap.setStyle(style);
  }
};

const tile2bound = (x, y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  const lat2 = (180 / Math.PI) * Math.atan(Math.sinh(n));
  const lon2 = (x / Math.pow(2, z)) * 360 - 180;
  
  const n2 = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z);
  const lat1 = (180 / Math.PI) * Math.atan(Math.sinh(n2));
  const lon1 = ((x + 1) / Math.pow(2, z)) * 360 - 180;

  return [[lat1, lon1], [lat2, lon2]];
};

const updateTileGridOverlay = () => {
  if (!map || !tileDebugLayerGroup) return;
  tileDebugLayerGroup.clearLayers();

  if (!showTileGridDebug.value) return;

  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const z = Math.floor(zoom);

  if (z < 7 || z > 20) return;

  const minLat = bounds.getSouth();
  const maxLat = bounds.getNorth();
  const minLon = bounds.getWest();
  const maxLon = bounds.getEast();

  const lat2tile = (lat, zoom) => (Math.floor((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2 * Math.pow(2, zoom)));
  const lon2tile = (lon, zoom) => (Math.floor((lon + 180) / 360 * Math.pow(2, zoom)));

  const xMin = Math.max(0, lon2tile(minLon, z));
  const xMax = Math.min(Math.pow(2, z) - 1, lon2tile(maxLon, z));
  const yMin = Math.max(0, lat2tile(maxLat, z));
  const yMax = Math.min(Math.pow(2, z) - 1, lat2tile(minLat, z));

  if ((xMax - xMin + 1) * (yMax - yMin + 1) > 40) return;

  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const tileBounds = tile2bound(x, y, z);
      const pbfUrl = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/${z}/${y}/${x}.pbf`;

      const rect = window.L.rectangle(tileBounds, {
        color: '#ff0000',
        weight: 2,
        fill: false,
        dashArray: '4, 4'
      });

      const centerLat = (tileBounds[0][0] + tileBounds[1][0]) / 2;
      const centerLon = (tileBounds[0][1] + tileBounds[1][1]) / 2;

      const divIcon = window.L.divIcon({
        className: 'tile-debug-label',
        html: `<div class="tile-url-box"><a href="${pbfUrl}" target="_blank">z:${z}/y:${y}/x:${x}<br>${pbfUrl}</a></div>`,
        iconSize: [200, 50],
        iconAnchor: [100, 25]
      });

      const marker = window.L.marker([centerLat, centerLon], { icon: divIcon });

      tileDebugLayerGroup.addLayer(rect);
      tileDebugLayerGroup.addLayer(marker);
    }
  }
};

const handleOrientation = (event) => {
  if (!isCompassActive.value || !glLayer) return;
  let heading = event.webkitCompassHeading !== undefined ? event.webkitCompassHeading : (event.alpha !== null ? 360 - event.alpha : null);
  if (heading !== null) {
    const maplibreMap = glLayer.getMaplibreMap?.();
    if (maplibreMap) maplibreMap.rotateTo(heading, { duration: 300 });
  }
};

const toggleCompass = async () => {
  if (isCompassActive.value) {
    window.removeEventListener('deviceorientation', handleOrientation);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    const maplibreMap = glLayer?.getMaplibreMap?.();
    if (maplibreMap) maplibreMap.rotateTo(0, { duration: 500 });
    isCompassActive.value = false;
    return;
  }

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') return;
    } catch (error) {
      console.error(error);
      return;
    }
  }

  window.addEventListener('deviceorientation', handleOrientation, true);
  isCompassActive.value = true;
};

// 【修改】不要用 import，改在 onMounted 中使用 fetch 載入
onMounted(async () => {
  await nextTick();
  const L = window.L;
  if (!L || !L.maplibreGL) return;

  try {
    // 1. 非同步讀取 public 資料夾中的 geojson 檔案
    const response = await fetch('/trafficspeed.geojson');
    const trafficSpeedGeoJson = await response.json();

    const basemapStyle = JSON.parse(JSON.stringify(basemapStyleRaw || {}));
    const layerStyle = JSON.parse(JSON.stringify(layerStyleRaw || {}));

    basemapStyle.sprite = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/resources/styles/light/sprite`;
    layerStyle.sprite = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/sprite`;

    if (basemapStyle.sources) {
      Object.keys(basemapStyle.sources).forEach((key) => {
        basemapStyle.sources[key].tiles = [BASEMAP_TILE_URL];
        basemapStyle.sources[key].minzoom = 7;
        basemapStyle.sources[key].maxzoom = 15;
        delete basemapStyle.sources[key].url;
      });
    }

    let layerStr = JSON.stringify(layerStyle);
    layerStr = layerStr.replace(/Arial Regular/g, 'Noto Sans Regular')
                     .replace(/Arial Bold/g, 'Noto Sans Bold')
                     .replace(/Arial/g, 'Noto Sans Regular');
    const parsedLayerStyle = JSON.parse(layerStr);

    const labelSourceKey = 'csdi-label-source';
    const trafficSourceKey = 'traffic-speed-source';  // 【新增】
    const trafficLayerKey = 'traffic-speed-layer';    // 【新增】

    const allLabelLayers = (parsedLayerStyle.layers || []).filter(layer => layer.type === 'symbol');

    allLabelLayers.forEach((layer) => {
      layer.source = labelSourceKey;
      if (layer.layout) {
        delete layer.layout['icon-image'];
        layer.layout['text-allow-overlap'] = false;
        layer.layout['text-ignore-placement'] = false;
      }
      if (layer.id.includes('Building') || layer.id.includes('1823_Static')) {
        if (layer.layout && !layer.layout['text-field']) {
          layer.layout['text-field'] = '{_name}';
        }
      }
    });

    const mergedStyle = {
      version: 8,
      sprite: basemapStyle.sprite,
      glyphs: `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/fonts/{fontstack}/{range}.pbf?`,
      sources: {
        ...basemapStyle.sources,
        [labelSourceKey]: {
          type: 'vector',
          tiles: [LABEL_TILE_URL],
          minzoom: 7,
          maxzoom: 15
        },
        // 【新增】動態載入的 GeoJSON 來源
        [trafficSourceKey]: {
          type: 'geojson',
          data: trafficSpeedGeoJson
        }
      },
      layers: [
        ...(basemapStyle.layers || []),
        ...allLabelLayers,
        // 【新增】交通速度 Line 圖層
        {
          id: trafficLayerKey,
          type: 'line',
          source: trafficSourceKey,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': 'visible'
          },
          paint: {
            // 使用 MapLibre match 表達式根據 ROAD_SATURATION_LEVEL 進行顏色分類
            'line-color': [
              'match',
              ['get', 'ROAD_SATURATION_LEVEL'],
              'TRAFFIC GOOD', '#00b050',      // 綠色
              'TRAFFIC AVERAGE', '#ffc000',   // 暗黃色
              '#ff0000'                       // 預設（其他 value 均顯示紅閊/紅色）
            ],
            'line-width': 4,
            'line-opacity': 0.85
          }
        }
      ]
    };

    mergedStyle.layers.forEach((layer) => {
      delete layer.maxzoom;

      if (layer.layout && layer.layout['text-size']) {
        originalFontSizes[layer.id] = JSON.parse(JSON.stringify(layer.layout['text-size']));
      }

      const colorProps = {};

      // 1. 收集 paint 內的顏色屬性（例如 fill-color, line-color, circle-color 等）
      if (layer.paint) {
        originalColors[layer.id] = JSON.parse(JSON.stringify(layer.paint));
        Object.keys(layer.paint).forEach((prop) => {
          if (prop.includes('color')) {
            const val = layer.paint[prop];
            if (typeof val === 'string') {
              colorProps[prop] = rgbToHex(val);
            }
          }
        });
      }

      // 2. 收集 layout 內的顏色屬性（例如 symbol/text 圖層的 text-color, icon-color 等）
      if (layer.layout) {
        Object.keys(layer.layout).forEach((prop) => {
          if (prop.includes('color')) {
            const val = layer.layout[prop];
            if (typeof val === 'string') {
              colorProps[prop] = rgbToHex(val);
            }
          }
        });
      }

      layerColorConfigs[layer.id] = {
        visible: layer.layout && layer.layout.visibility === 'none' ? false : true,
        colors: colorProps
      };
    });

    map = L.map('map', {
      center: [22.3193, 114.1694],
      zoom: 15,
      minZoom: 7,
      maxZoom: 20,
      touchZoom: true,
      dragging: true,
      zoomControl: false,
      fadeAnimation: false
    });

    L.control.zoom({ position: 'topright' }).addTo(map);
    tileDebugLayerGroup = L.layerGroup().addTo(map);

    currentZoom.value = map.getZoom();

    glLayer = L.maplibreGL({
      style: mergedStyle,
      transformRequest: (url, resourceType) => {
        let reqUrl = url;
        if (reqUrl && reqUrl.includes('/fonts/')) {
          reqUrl = reqUrl.replace(/Arial%20Regular/g, 'Noto%20Sans%20Regular')
                         .replace(/Arial Regular/g, 'Noto Sans Regular')
                         .replace(/Arial%20Bold/g, 'Noto%20Sans%20Bold')
                         .replace(/Arial Bold/g, 'Noto Sans Bold')
                         .replace(/Arial/g, 'Noto%20Sans%20Regular');
        }
        return { url: reqUrl };
      }
    });

    glLayer.addTo(map);

    const refreshMap = () => {
      currentZoom.value = map.getZoom();
      updateTileGridOverlay();

      const maplibreMap = glLayer?.getMaplibreMap?.();
      if (maplibreMap) {
        maplibreMap.triggerRepaint();
      }
    };

    map.on('move zoom', refreshMap);

    map.on('resize', () => {
      const maplibreMap = glLayer?.getMaplibreMap?.();
      if (maplibreMap) {
        maplibreMap.resize();
      }
    });

    // 【新增】動態攔截並補上缺失的 Sprite 圖標，解決 styleimagemissing 問題
    const maplibreMap = glLayer.getMaplibreMap?.();
    if (maplibreMap) {
      maplibreMap.on('styleimagemissing', (e) => {
        const id = e.id;

        // 【關鍵修正】只針對 MTR 相關的 icon 補畫紅色圓點，其他未定義的 icon 一律略過（或給予透明圖片）
        if (id && id.includes('MTR_POINT')) {
          const width = 16;
          const height = 16;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          ctx.fillStyle = '#ff0000';
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          const imgData = ctx.getImageData(0, 0, width, height);

          if (!maplibreMap.hasImage(id)) {
            maplibreMap.addImage(id, imgData);
          }
        } else {
          // 對於其他非 MTR 的缺失圖標，建立一個 1x1 的透明圖片防止 MapLibre 持續發出警告
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          const imgData = ctx.getImageData(0, 0, 1, 1);
          if (!maplibreMap.hasImage(id)) {
            maplibreMap.addImage(id, imgData);
          }
        }
      });
    }

  } catch (error) {
    console.error('初始化地圖失敗：', error);
  }
});

onUnmounted(() => {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  window.removeEventListener('deviceorientation', handleOrientation);
  if (map) map.remove();
});
</script>

<style scoped>
#map-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

#map {
  width: 100%;
  height: 100%;
  touch-action: none;
}

.control-panel {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  padding: 12px;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 280px;
  max-height: 85vh;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.control-panel.minimized {
  padding: 8px 12px;
  width: auto;
  max-width: 160px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.header-title {
  font-size: 13px;
  font-weight: 700;
  color: #333;
}

.minimize-btn {
  background: #f0f2f5;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #555;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.minimize-btn:hover {
  background: #e4e7ed;
  color: #000;
}

.force-refresh-btn {
  width: 100%;
  background: #e6a23c;
  color: #fff;
  border: none;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.force-refresh-btn:hover {
  background: #cf9236;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.panel-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.layer-color-group {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.layer-search-input {
  width: 100%;
  padding: 5px 8px;
  font-size: 11px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  outline: none;
  background: #fff;
  box-sizing: border-box;
  margin-bottom: 4px;
}

.layer-search-input:focus {
  border-color: #409eff;
}

.layer-color-scroll {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}

.layer-color-item {
  background: #f8f9fa;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.layer-item-header {
  display: flex;
  align-items: center;
}

.layer-switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  width: 100%;
  overflow: hidden;
}

.layer-id-text {
  font-size: 11px;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.color-pickers {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding-left: 18px;
}

.color-picker-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #666;
}

.color-picker-label input[type="color"] {
  width: 24px;
  height: 20px;
  border: none;
  background: none;
  cursor: pointer;
}

.group-title {
  font-size: 11px;
  font-weight: 700;
  color: #666;
  text-transform: uppercase;
}

.checkbox-label {
  font-size: 12px;
  color: #333;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-weight: 500;
}

.zoom-display {
  font-size: 13px;
  color: #333;
  background: #f0f2f5;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #dcdfe6;
  text-align: center;
}

.button-row {
  display: flex;
  gap: 6px;
}

.button-row button {
  flex: 1;
  background: #f0f2f5;
  color: #222;
  border: 1px solid #dcdfe6;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.button-row button:hover {
  background: #e4e7ed;
}

.button-row button.active {
  background: #008000;
  color: #fff;
  border-color: #008000;
}

:deep(.tile-url-box) {
  background: rgba(0, 0, 0, 0.85);
  color: #00ffcc;
  padding: 6px 8px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  pointer-events: auto;
  white-space: nowrap;
}

:deep(.tile-url-box a) {
  color: #61dafb;
  text-decoration: none;
}

:deep(.tile-url-box a:hover) {
  text-decoration: underline;
}

.compass-btn {
  position: absolute;
  bottom: calc(30px + env(safe-area-inset-bottom));
  right: 16px;
  z-index: 1000;
  background: #ffffff;
  color: #333333;
  border: 1px solid rgba(0, 0, 0, 0.2);
  padding: 10px 16px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  white-space: nowrap;
}

@media (max-width: 480px) {
  .control-panel {
    top: 10px;
    left: 10px;
    right: 10px;
    max-width: none;
    padding: 8px 10px;
    gap: 6px;
  }
  .button-row button {
    padding: 5px 6px;
    font-size: 11px;
  }
}
</style>