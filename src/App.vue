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
        <span class="group-title">🎨 地圖主題</span>
        <div class="button-row">
          <button @click="toggleTheme('dark')" :class="{ active: currentTheme === 'dark' }">🌙 暗黑模式</button>
          <button @click="toggleTheme('light')" :class="{ active: currentTheme === 'light' }">☀️ 淺色模式</button>
        </div>
      </div>

      <!-- 官方鐵路出入口圖層控制 -->
      <div class="panel-group">
        <span class="group-title">🚇 官方鐵路出入口圖層</span>
        <label class="checkbox-label">
          <input type="checkbox" v-model="isRailwayVisible" @change="toggleRailwayLayer" />
          顯示鐵路出入口 (Lv17-20)
        </label>
        <div class="button-row" style="margin-top: 6px;">
          <button @click="toggleRailwayColor" :class="{ active: isTransportGreen }">
            {{ isTransportGreen ? '🟢 運輸署綠色' : '🎨 官方原色' }}
          </button>
        </div>
      </div>

      <!-- 當前 Zoom Level 顯示 -->
      <div class="panel-group">
        <span class="group-title">🔍 地圖層級</span>
        <div class="zoom-display">Zoom: <strong>{{ currentZoom }}</strong></div>
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
const fontScaleMultiplier = ref(1.0);
const currentZoom = ref(15);

const isRailwayVisible = ref(true);
const isTransportGreen = ref(false);
const railwayLayerIds = ref([]);
let originalRailwayColors = {};

const API_KEY = 'b35fa889d114486a90ea5133d5ff3ce4';
const LANG = 'tc';
const isProd = import.meta.env.PROD;
const CSDI_HOST = isProd 
  ? 'https://mapapi.geodata.gov.hk/gs/api' 
  : `${window.location.origin}/csdi-api`;

const BASEMAP_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf?key=${API_KEY}`;
const BASEMAP_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/HK80/resources/styles/root.json?key=${API_KEY}`;
const LABEL_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/{z}/{y}/{x}.pbf?key=${API_KEY}`;
const LABEL_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/root.json?key=${API_KEY}`;

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
    if (railwayLayerIds.value.includes(layerId)) return;

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

const toggleRailwayLayer = () => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  const visibility = isRailwayVisible.value ? 'visible' : 'none';
  railwayLayerIds.value.forEach((layerId) => {
    if (maplibreMap.getLayer(layerId)) {
      maplibreMap.setLayoutProperty(layerId, 'visibility', visibility);
    }
  });
};

const toggleRailwayColor = () => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  isTransportGreen.value = !isTransportGreen.value;

  railwayLayerIds.value.forEach((layerId) => {
    const layer = maplibreMap.getLayer(layerId);
    if (!layer) return;

    if (isTransportGreen.value) {
      if (layer.type === 'fill') {
        maplibreMap.setPaintProperty(layerId, 'fill-color', '#008000');
      } else if (layer.type === 'line') {
        maplibreMap.setPaintProperty(layerId, 'line-color', '#008000');
      } else if (layer.type === 'circle') {
        maplibreMap.setPaintProperty(layerId, 'circle-color', '#008000');
      }
    } else {
      const orig = originalRailwayColors[layerId];
      if (orig) {
        Object.keys(orig).forEach((prop) => {
          maplibreMap.setPaintProperty(layerId, prop, orig[prop]);
        });
      }
    }
  });
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
        basemapStyle.sources[key].maxzoom = 15;
        delete basemapStyle.sources[key].url;
      });
    }

    const officialRailwayLayers = [];
    if (basemapStyle.layers) {
      basemapStyle.layers.forEach((layer) => {
        if (layer.id.includes('RailwayEntrance_5K')) {
          railwayLayerIds.value.push(layer.id);
          if (layer.layout) {
            delete layer.layout['icon-image']; // 移除圖標相依避免崩潰
          }
          officialRailwayLayers.push(layer);
        }
      });

      // 過濾掉其他有問題的 symbol 層，但保留我們剛才抓出來的 officialRailwayLayers
      basemapStyle.layers = basemapStyle.layers.filter((layer) => {
        if (layer.id.includes('RailwayEntrance_5K')) return true;
        if (layer.type === 'symbol') return false;
        return true;
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
      delete layer.maxzoom;
      if (layer.layout) {
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
          maxzoom: 20
        }
      },
      layers: [
        ...(basemapStyle.layers || []),
        ...labelLayers
      ]
    };

    mergedStyle.layers.forEach((layer) => {
      if (layer.layout && layer.layout['text-size']) {
        originalFontSizes[layer.id] = JSON.parse(JSON.stringify(layer.layout['text-size']));
      }
      if (layer.paint) {
        originalColors[layer.id] = JSON.parse(JSON.stringify(layer.paint));
        if (railwayLayerIds.value.includes(layer.id)) {
          originalRailwayColors[layer.id] = JSON.parse(JSON.stringify(layer.paint));
        }
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

    currentZoom.value = map.getZoom();
    map.on('zoom', () => {
      currentZoom.value = map.getZoom();
    });

    glLayer = L.maplibreGL({
      style: mergedStyle,
      transformRequest: (url) => {
        let reqUrl = url;
        if (reqUrl.includes('/fonts/')) {
          reqUrl = reqUrl.replace(/Arial%20Regular/g, 'Noto%20Sans%20Regular')
                         .replace(/Arial Regular/g, 'Noto Sans Regular')
                         .replace(/Arial%20Bold/g, 'Noto%20Sans%20Bold')
                         .replace(/Arial Bold/g, 'Noto Sans Bold')
                         .replace(/Arial/g, 'Noto%20Sans%20Regular');
        }
        if (reqUrl.includes('mapapi.geodata.gov.hk') && !reqUrl.includes('key=')) {
          reqUrl += (reqUrl.includes('?') ? '&' : '?') + `key=${API_KEY}`;
        }
        return { url: reqUrl };
      }
    });

    glLayer.addTo(map);

    const marker = L.marker([22.3193, 114.1694]).addTo(map);
    marker.bindPopup('<b>香港特別行政區</b><br>Official Railway Layer Loaded Successfully!').openPopup();

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
  font-weight: 600;
  color: #333;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
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