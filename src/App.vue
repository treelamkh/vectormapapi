<template>
  <div id="map-container">
    <div id="map"></div>

    <!-- 左上角控制面板 -->
    <div class="control-panel">
      <div class="panel-group">
        <span class="group-title">🔤 文字大小</span>
        <div class="button-row">
          <button @click="changeFontSize(1.15)">🔤 字體 +</button>
          <button @click="changeFontSize(0.85)">🔠 字體 -</button>
        </div>
      </div>

      <div class="panel-group">
        <span class="group-title">🏢 建築物圖層</span>
        <div class="button-row">
          <button @click="setBuildingVisibility(true)">👁️ 顯示建築</button>
          <button @click="setBuildingVisibility(false)">🙈 隱藏建築</button>
        </div>
      </div>

      <div class="panel-group">
        <span class="group-title">🛣️ 道路面圖層</span>
        <div class="button-row">
          <button @click="setRoadVisibility(true)">👁️ 顯示道路面</button>
          <button @click="setRoadVisibility(false)">🙈 隱藏道路面</button>
        </div>
      </div>

      <div class="panel-group">
        <span class="group-title">🎨 地圖主題</span>
        <div class="button-row">
          <button @click="toggleTheme('dark')" :class="{ active: currentTheme === 'dark' }">🌙 暗黑模式</button>
          <button @click="toggleTheme('light')" :class="{ active: currentTheme === 'light' }">☀️ 淺色模式</button>
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
import { ref, onMounted, onUnmounted } from 'vue';

let map = null;
let glLayer = null;
let watchId = null;

const isCompassActive = ref(false);
const currentTheme = ref('light');
const fontScaleMultiplier = ref(1.0); // 記錄當前字體縮放倍率

const API_KEY = 'b35fa889d114486a90ea5133d5ff3ce4';
const LANG = 'tc';
const isProd = import.meta.env.PROD;
const CSDI_HOST = isProd 
  ? 'https://mapapi.geodata.gov.hk/gs/api' 
  : `${window.location.origin}/csdi-api`;

// 1. 底圖與標籤 API
const BASEMAP_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf?key=${API_KEY}`;
const BASEMAP_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/resources/styles/root.json?key=${API_KEY}`;
const LABEL_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/{z}/{y}/{x}.pbf?key=${API_KEY}`;
const LABEL_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/root.json?key=${API_KEY}`;

// 原始樣式備份（用於字體大小基準計算與主題還原）
let originalFontSizes = {};
let originalColors = {};

// ----------------------------------------------------
// 功能 1 & 2：動態字體放大 / 縮小
// ----------------------------------------------------
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

// ----------------------------------------------------
// 功能 3 & 4：開關建築物圖層 (All Building Layers)
// ----------------------------------------------------
const setBuildingVisibility = (visible) => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  const style = maplibreMap.getStyle();
  if (!style || !style.layers) return;

  style.layers.forEach((layer) => {
    // 匹配 CSDI 建築物圖層關鍵字（如 building, structure, edb 等）
    const layerId = layer.id.toLowerCase();
    const sourceLayer = (layer['source-layer'] || '').toLowerCase();

    if (
      layerId.includes('building') ||
      layerId.includes('structure') ||
      sourceLayer.includes('building') ||
      sourceLayer.includes('structure')
    ) {
      maplibreMap.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  });
};

// ----------------------------------------------------
// 功能 5 & 6：開關道路面圖層 (All Road Polygon Layers)
// ----------------------------------------------------
const setRoadVisibility = (visible) => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  const style = maplibreMap.getStyle();
  if (!style || !style.layers) return;

  style.layers.forEach((layer) => {
    const layerId = layer.id.toLowerCase();
    const sourceLayer = (layer['source-layer'] || '').toLowerCase();

    // 匹配道路面/路面多邊形圖層（如 road, carriageway, highway 等面圖層）
    if (
      (layerId.includes('road') || layerId.includes('carriageway') || sourceLayer.includes('road')) &&
      layer.type === 'fill'
    ) {
      maplibreMap.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    }
  });
};

// ----------------------------------------------------
// 功能 7 & 8：切換 Dark Mode / Light Mode
// ----------------------------------------------------
const toggleTheme = (mode) => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  currentTheme.value = mode;
  const style = maplibreMap.getStyle();
  if (!style || !style.layers) return;

  style.layers.forEach((layer) => {
    const layerId = layer.id;

    if (mode === 'dark') {
      // 暗黑模式調色盤
      if (layer.type === 'background') {
        maplibreMap.setPaintProperty(layerId, 'background-color', '#12161f');
      } else if (layer.type === 'fill') {
        if (layerId.includes('water')) {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#0e2a47'); // 水體
        } else if (layerId.includes('park') || layerId.includes('green')) {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#163321'); // 綠地
        } else if (layerId.includes('building')) {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#252d3a'); // 建築
        } else {
          maplibreMap.setPaintProperty(layerId, 'fill-color', '#1c2333'); // 陸地背景
        }
      } else if (layer.type === 'line') {
        maplibreMap.setPaintProperty(layerId, 'line-color', '#2c374e'); // 道路/邊界
      } else if (layer.type === 'symbol') {
        if (layer.paint && layer.paint['text-color']) {
          maplibreMap.setPaintProperty(layerId, 'text-color', '#e0e6ed'); // 文字變白
        }
        if (layer.paint && layer.paint['text-halo-color']) {
          maplibreMap.setPaintProperty(layerId, 'text-halo-color', '#12161f'); // 文字外框變深
        }
      }
    } else {
      // 恢復原始 Light 模式顏色
      const orig = originalColors[layerId];
      if (orig) {
        Object.keys(orig).forEach((prop) => {
          maplibreMap.setPaintProperty(layerId, prop, orig[prop]);
        });
      }
    }
  });
};

// ----------------------------------------------------
// 指南針方向旋轉控制
// ----------------------------------------------------
const handleOrientation = (event) => {
  if (!isCompassActive.value || !glLayer) return;

  let heading = null;
  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading;
  } else if (event.alpha !== null) {
    heading = 360 - event.alpha;
  }

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
      if (permission !== 'granted') {
        alert('請允許取用指南針方向權限');
        return;
      }
    } catch (error) {
      console.error('指南針授權失敗:', error);
      return;
    }
  }

  window.addEventListener('deviceorientation', handleOrientation, true);
  isCompassActive.value = true;
};

// ----------------------------------------------------
// 地圖初始化
// ----------------------------------------------------
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
        basemapStyle.sources[key].maxzoom = 15;
        delete basemapStyle.sources[key].url;
      });
    }

    let labelStr = JSON.stringify(labelStyle);
    labelStr = labelStr.replace(/Arial Regular/g, 'Noto Sans Regular');
    labelStr = labelStr.replace(/Arial Bold/g, 'Noto Sans Bold');
    labelStr = labelStr.replace(/Arial/g, 'Noto Sans Regular');
    labelStyle = JSON.parse(labelStr);

    const labelSourceKey = 'csdi-label-source';
    const labelLayers = labelStyle.layers || [];
    labelLayers.forEach((layer) => {
      layer.source = labelSourceKey;
      if (layer.layout && layer.layout['icon-image']) {
        delete layer.layout['icon-image'];
      }
    });

    const mergedStyle = {
      version: 8,
      glyphs: `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/fonts/{fontstack}/{range}.pbf?key=${API_KEY}`,
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
        ...labelLayers
      ]
    };

    // 備份初始文字大小與顏色
    mergedStyle.layers.forEach((layer) => {
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
      maxZoom: 19,
      touchZoom: true,
      dragging: true
    });

    glLayer = L.maplibreGL({
      style: mergedStyle,
      transformRequest: (url) => {
        let reqUrl = url;
        if (reqUrl.includes('/fonts/')) {
          reqUrl = reqUrl.replace(/Arial%20Regular/g, 'Noto%20Sans%20Regular');
          reqUrl = reqUrl.replace(/Arial Regular/g, 'Noto Sans Regular');
          reqUrl = reqUrl.replace(/Arial%20Bold/g, 'Noto%20Sans%20Bold');
          reqUrl = reqUrl.replace(/Arial Bold/g, 'Noto Sans Bold');
          reqUrl = reqUrl.replace(/Arial/g, 'Noto%20Sans%20Regular');
        }
        if (reqUrl.includes('mapapi.geodata.gov.hk') && !reqUrl.includes('key=')) {
          reqUrl += (reqUrl.includes('?') ? '&' : '?') + `key=${API_KEY}`;
        }
        return { url: reqUrl };
      }
    });

    glLayer.addTo(map);

    const marker = L.marker([22.3193, 114.1694]).addTo(map);
    marker.bindPopup('<b>香港特別行政區</b><br>CSDI Vector Map Dynamic Controls!').openPopup();

  } catch (error) {
    console.error('地圖載入失敗：', error);
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

/* 左上角控制面板 */
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
  background: #409eff;
  color: #fff;
  border-color: #409eff;
}

/* 右下角指南針按鈕 */
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