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

      <!-- 鐵路出入口圖層控制 -->
      <div class="panel-group">
        <span class="group-title">🚇 港鐵出入口圖標圖層</span>
        <label class="checkbox-label">
          <input type="checkbox" v-model="isRailwayVisible" @change="toggleRailwayLayer" />
          顯示 MTR 出入口 (Lv17-20)
        </label>
        <div class="button-row" style="margin-top: 6px;">
          <button @click="toggleRailwayColor" :class="{ active: isTransportGreen }">
            {{ isTransportGreen ? '🟢 運輸署綠色' : '🔵 MTR 經典藍' }}
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
    if (layerId === 'mtr-entrance-symbol-17' || layerId === 'mtr-entrance-symbol-19') return;

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
  if (maplibreMap.getLayer('mtr-entrance-symbol-17')) {
    maplibreMap.setLayoutProperty('mtr-entrance-symbol-17', 'visibility', visibility);
  }
  if (maplibreMap.getLayer('mtr-entrance-symbol-19')) {
    maplibreMap.setLayoutProperty('mtr-entrance-symbol-19', 'visibility', visibility);
  }
};

const updateMtrIconImage = (maplibreMap, colorHex) => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = colorHex;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(18, 32); ctx.lineTo(46, 32);
  ctx.moveTo(24, 20); ctx.lineTo(40, 44);
  ctx.moveTo(24, 44); ctx.lineTo(40, 20);
  ctx.stroke();

  const imgData = ctx.getImageData(0, 0, 64, 64);
  if (maplibreMap.hasImage('mtr-logo-dynamic')) {
    maplibreMap.updateImage('mtr-logo-dynamic', imgData);
  } else {
    maplibreMap.addImage('mtr-logo-dynamic', imgData);
  }
};

const toggleRailwayColor = () => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  isTransportGreen.value = !isTransportGreen.value;
  const colorHex = isTransportGreen.value ? '#008000' : '#0055b8';
  updateMtrIconImage(maplibreMap, colorHex);
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

    if (basemapStyle.layers) {
      basemapStyle.layers = basemapStyle.layers.filter((layer) => {
        if (layer.id.includes('RailwayEntrance_5K')) return false;
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

    const firstSourceKey = Object.keys(basemapStyle.sources)[0] || 'vector_tile_source';

    mergedStyle.layers.push({
      id: 'mtr-entrance-symbol-17',
      type: 'symbol',
      source: firstSourceKey,
      'source-layer': '0_RailwayEntrance_5K:1',
      minzoom: 17,
      maxzoom: 19,
      layout: {
        'icon-image': 'mtr-logo-dynamic',
        'icon-size': 0.5,
        'icon-allow-overlap': true
      }
    });

    mergedStyle.layers.push({
      id: 'mtr-entrance-symbol-19',
      type: 'symbol',
      source: firstSourceKey,
      'source-layer': '0_RailwayEntrance_5K:2',
      minzoom: 19,
      maxzoom: 20,
      layout: {
        'icon-image': 'mtr-logo-dynamic',
        'icon-size': 0.65,
        'icon-allow-overlap': true
      }
    });

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

    const maplibreMap = glLayer.getMaplibreMap();
    if (maplibreMap) {
      maplibreMap.on('load', () => {
        updateMtrIconImage(maplibreMap, '#0055b8');
      });

      // 改用更穩健的全局點擊查詢 (queryRenderedFeatures)
      maplibreMap.on('click', (e) => {
        const bbox = [
          [e.point.x - 8, e.point.y - 8],
          [e.point.x + 8, e.point.y + 8]
        ];
        const features = maplibreMap.queryRenderedFeatures(bbox, {
          layers: ['mtr-entrance-symbol-17', 'mtr-entrance-symbol-19']
        });

        if (features.length === 0) return;

        const feature = features[0];
        const props = feature.properties;

        let htmlContent = `<div style="font-family: sans-serif; max-height: 220px; overflow-y: auto; padding: 4px;">
          <b style="color: #0055b8; font-size: 14px;">🚇 港鐵出入口資訊</b><hr style="margin: 6px 0;">`;
        
        for (const [key, val] of Object.entries(props)) {
          htmlContent += `<div style="font-size: 12px; margin-bottom: 2px;"><b>${key}:</b> ${val}</div>`;
        }
        htmlContent += `</div>`;

        new L.Popup()
          .setLatLng([e.lngLat.lat, e.lngLat.lng])
          .setContent(htmlContent)
          .openOn(map);
      });

      // 滑鼠移到圖標上時變成手指指標
      ['mtr-entrance-symbol-17', 'mtr-entrance-symbol-19'].forEach((layerId) => {
        maplibreMap.on('mouseenter', layerId, () => {
          maplibreMap.getCanvas().style.cursor = 'pointer';
        });
        maplibreMap.on('mouseleave', layerId, () => {
          maplibreMap.getCanvas().style.cursor = '';
        });
      });
    }

    const marker = L.marker([22.3193, 114.1694]).addTo(map);
    marker.bindPopup('<b>香港特別行政區</b><br>Clickable MTR Logos Ready!').openPopup();

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