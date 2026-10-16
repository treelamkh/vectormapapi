<template>
  <div id="map-container">
    <div id="map"></div>

    <!-- 左上角控制面板 -->
    <div class="control-panel">
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

      <!-- 當前 Zoom Level 顯示 -->
      <div class="panel-group">
        <span class="group-title">🔍 地圖層級</span>
        <div class="zoom-display">Zoom: <strong>{{ currentZoom }}</strong></div>
      </div>

      <!-- 【Debug 工具】Tile 網格與 Pbf 網址視覺化開關 -->
      <div class="panel-group">
        <span class="group-title">🛠️ Debug 工具</span>
        <label class="checkbox-label">
          <input type="checkbox" v-model="showTileGridDebug" @change="updateTileGridOverlay" />
          顯示 Tile 邊界與 PBF 網址
        </label>
      </div>
    </div>

    <!-- 右下角指南針旋轉按鈕 -->
    <button class="compass-btn" @click="toggleCompass">
      {{ isCompassActive ? '🧭 關閉追蹤方向' : '🧭 隨方向旋轉' }}
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

let map = null;
let glLayer = null;
let watchId = null;
let tileDebugLayerGroup = null;

const isCompassActive = ref(false);
const currentTheme = ref('light');
const fontScaleMultiplier = ref(1.0);
const currentZoom = ref(15);

const showTileGridDebug = ref(false);

const LANG = 'tc';
const isProd = import.meta.env.PROD;
const CSDI_HOST = isProd 
  ? 'https://mapapi.geodata.gov.hk/gs/api' 
  : `${window.location.origin}/csdi-api`;

const BASEMAP_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf`;
const BASEMAP_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/resources/styles/root.json`;
const LABEL_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/{z}/{y}/{x}.pbf?`;
const LABEL_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/root.json`;

let originalFontSizes = {};
let originalColors = {};

const changeFontSize = (factor) => {
  const maplibreMap = glLayer?.getMaplibreMap();
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
  const maplibreMap = glLayer?.getMaplibreMap();
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
          maplibreMap.setPaintProperty(layerId, prop, orig[prop]);
        });
      }
    }
  });
};

// --- 數學工具：將 XYZ Tile 轉換為經緯度邊界 ---
const tile2bound = (x, y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  const lat2 = (180 / Math.PI) * Math.atan(Math.sinh(n));
  const lon2 = (x / Math.pow(2, z)) * 360 - 180;
  
  const n2 = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z);
  const lat1 = (180 / Math.PI) * Math.atan(Math.sinh(n2));
  const lon1 = ((x + 1) / Math.pow(2, z)) * 360 - 180;

  return [[lat1, lon1], [lat2, lon2]];
};

// --- 更新畫面上的 Tile 紅框與網址 ---
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
      const effectiveZ = Math.min(z, 15);
      const pbfUrl = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/${effectiveZ}/{y}/{x}.pbf`;

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
        html: `<div class="tile-url-box"><a href="${pbfUrl}" target="_blank">z:${z}(req:${effectiveZ})/y:${y}/x:${x}<br>${pbfUrl}</a></div>`,
        iconSize: [220, 60],
        iconAnchor: [110, 30]
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
    const maplibreMap = glLayer.getMaplibreMap();
    if (maplibreMap) maplibreMap.rotateTo(heading, { duration: 300 });
  }
};

const toggleCompass = async () => {
  if (isCompassActive.value) {
    window.removeEventListener('deviceorientation', handleOrientation);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    const maplibreMap = glLayer?.getMaplibreMap();
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

onMounted(async () => {
  const L = window.L;
  if (!L || !L.maplibreGL) return;

  try {
    const [basemapRes, labelRes] = await Promise.all([
      fetch(BASEMAP_STYLE_URL),
      fetch(LABEL_STYLE_URL)
    ]);

    const basemapStyle = await basemapRes.json();
    let labelStyle = await labelRes.json();

    delete basemapStyle.sprite;
    delete labelStyle.sprite;

    if (basemapStyle.sources) {
      Object.keys(basemapStyle.sources).forEach((key) => {
        basemapStyle.sources[key].tiles = [BASEMAP_TILE_URL];
        basemapStyle.sources[key].minzoom = 7;
        basemapStyle.sources[key].maxzoom = 15; // 💡 限制 Basemap source 最高到 15，超過時交由 transformRequest 統一降級
        delete basemapStyle.sources[key].url;
      });
    }

    let labelStr = JSON.stringify(labelStyle);
    labelStr = labelStr.replace(/Arial Regular/g, 'Noto Sans Regular')
                     .replace(/Arial Bold/g, 'Noto Sans Bold')
                     .replace(/Arial/g, 'Noto Sans Regular');
    labelStyle = JSON.parse(labelStr);

    const labelSourceKey = 'csdi-label-source';

    const allLabelLayers = (labelStyle.layers || []).filter(layer => layer.type === 'symbol');

    allLabelLayers.forEach((layer) => {
      layer.source = labelSourceKey;
      
      if (layer.layout) {
        delete layer.layout['icon-image'];
        layer.layout['text-allow-overlap'] = true;
        layer.layout['text-ignore-placement'] = true;
      }

      if (layer.id.includes('Building') || layer.id.includes('1823_Static')) {
        if (layer.layout && !layer.layout['text-field']) {
          layer.layout['text-field'] = '{_name}';
        }
      }
    });

    const mergedStyle = {
      version: 8,
      glyphs: `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/fonts/{fontstack}/{range}.pbf?`,
      sources: {
        ...basemapStyle.sources,
        [labelSourceKey]: {
          type: 'vector',
          tiles: [LABEL_TILE_URL],
          minzoom: 7,
          maxzoom: 15
        }
      },
      layers: [
        ...(basemapStyle.layers || []),
        ...allLabelLayers
      ]
    };

    mergedStyle.layers.forEach((layer) => {
      delete layer.maxzoom;

      if (layer.layout && layer.layout['text-size']) {
        originalFontSizes[layer.id] = JSON.parse(JSON.stringify(layer.layout['text-size']));
      }
      if (layer.paint) {
        originalColors[layer.id] = JSON.parse(JSON.stringify(layer.paint));
      }
    });

    map = L.map('map', {
      center: [22.3193, 114.1694],
      zoom: 15,
      minZoom: 7,
      maxZoom: 20,
      touchZoom: true,
      dragging: true,
      zoomControl: false
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    tileDebugLayerGroup = L.layerGroup().addTo(map);

    currentZoom.value = map.getZoom();
    map.on('zoom', () => {
      currentZoom.value = map.getZoom();
      updateTileGridOverlay();
    });

    map.on('moveend', () => {
      updateTileGridOverlay();
    });

    glLayer = L.maplibreGL({
      style: mergedStyle,
      transformRequest: (url, resourceType) => {
        let reqUrl = url;
        if (reqUrl.includes('/fonts/')) {
          reqUrl = reqUrl.replace(/Arial%20Regular/g, 'Noto%20Sans%20Regular')
                         .replace(/Arial Regular/g, 'Noto Sans Regular')
                         .replace(/Arial%20Bold/g, 'Noto%20Sans%20Bold')
                         .replace(/Arial Bold/g, 'Noto Sans Bold')
                         .replace(/Arial/g, 'Noto%20Sans%20Regular');
        }

        // 💡 核心修改：同時攔截 Basemap 同 Label 的 tile 請求，若 zoom > 15，自動降級至 level 15
        if (reqUrl.includes('/vt/') && reqUrl.includes('/tile/')) {
          const match = reqUrl.match(/\/tile\/(\d+)\/(\d+)\/(\d+)\.pbf/);
          if (match) {
            const zVal = parseInt(match[1], 10);
            if (zVal > 15) {
              reqUrl = reqUrl.replace(`/tile/${zVal}/`, `/tile/15/`);
            }
          }
        }

        if (reqUrl.includes('mapapi.geodata.gov.hk')) {
          reqUrl += (reqUrl.includes('?') ? '&' : '?');
        }
        return { url: reqUrl };
      }
    });

    glLayer.addTo(map);

    glLayer.on('add', () => {
      const maplibreMap = glLayer.getMaplibreMap();
      if (!maplibreMap) return;
      window.debugMap = maplibreMap;
      maplibreMap.on('load', () => {
        console.log("=== MapLibre Loaded Successfully ===");
      });
    });

    map.on('moveend zoomend resize', () => {
      const maplibreMap = glLayer?.getMaplibreMap?.();
      if (maplibreMap) {
        maplibreMap.resize();
      }
    });

    const marker = L.marker([22.3193, 114.1694]).addTo(map);
    marker.bindPopup('<b>香港特別行政區</b><br>Building Labels Unified!').openPopup();

  } catch (error) {
    console.error('載入失敗：', error);
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
  max-width: 250px;
}

.panel-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

/* Tile 內嵌 URL 標籤樣式 */
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