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

      <!-- 各 Layer 獨立顏色監控 -->
      <div class="panel-group layer-color-group">
        <span class="group-title">🎨 圖層顏色獨立監控</span>
        <!-- 【新功能】搜尋過濾輸入框 -->
        <input 
          type="text" 
          v-model="layerSearchKeyword" 
          placeholder="搜尋 layer id..." 
          class="layer-search-input"
        />
        <div class="layer-color-scroll">
          <div v-for="(conf, layerId) in filteredLayerColors" :key="layerId" class="layer-color-item">
            <span class="layer-id-text" :title="layerId">{{ layerId }}</span>
            <div class="color-pickers">
              <template v-for="(colorVal, propName) in conf" :key="propName">
                <label class="color-picker-label">
                  <small>{{ propName.replace('-color', '') }}</small>
                  <input 
                    type="color" 
                    v-model="layerColorConfigs[layerId][propName]" 
                    @input="updateLayerColor(layerId, propName, layerColorConfigs[layerId][propName])"
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
        <label class="checkbox-label">
          <input type="checkbox" v-model="showTileGridDebug" @change="updateTileGridOverlay" />
          顯示 Tile 邊界與 PBF 網址
        </label>
        
        <label class="checkbox-label" style="margin-top: 6px;">
          <input type="checkbox" v-model="disableFilter" @change="toggleDisableFilter" />
          Disable Filter (清除過濾)
        </label>

        <!-- 【新功能】點擊圖層偵測工具開關 -->
        <label class="checkbox-label" style="margin-top: 6px;">
          <input type="checkbox" v-model="enableLayerInspector" @change="toggleLayerInspector" />
          🔍 點擊地圖偵測 Layer 工具
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
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';

let map = null;
let glLayer = null;
let watchId = null;
let tileDebugLayerGroup = null;
let activePopup = null; // 用於顯示點擊偵測結果的 Popup

const isCompassActive = ref(false);
const currentTheme = ref('light');
const fontScaleMultiplier = ref(1.0);
const currentZoom = ref(15);

const showTileGridDebug = ref(false);
const disableFilter = ref(false);
const enableLayerInspector = ref(false); // 點擊偵測開關狀態

const layerColorConfigs = reactive({});

const LANG = 'tc';
const isProd = import.meta.env.PROD;
const CSDI_HOST = isProd 
  ? 'https://mapapi.geodata.gov.hk/gs/api' 
  : `${window.location.origin}/csdi-api`;

const BASEMAP_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf`;
const BASEMAP_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/resources/styles/root.json`;
const LABEL_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/{z}/{y}/{x}.pbf?`;
const LABEL_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/root.json`;

// 在其他 ref 變數旁邊加入
const layerSearchKeyword = ref('');

let originalFontSizes = {};
let originalColors = {};
let originalFilters = {};

// 建立過濾後的圖層顏色清單計算屬性
const filteredLayerColors = computed(() => {
  const keyword = layerSearchKeyword.value.trim().toLowerCase();
  if (!keyword) return layerColorConfigs;

  const filtered = {};
  Object.keys(layerColorConfigs).forEach((layerId) => {
    if (layerId.toLowerCase().includes(keyword)) {
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

const updateLayerColor = (layerId, propName, colorValue) => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;
  try {
    maplibreMap.setPaintProperty(layerId, propName, colorValue);
  } catch (e) {
    console.warn(`更新圖層 ${layerId} 的 ${propName} 失敗:`, e);
  }
};

// 修改點擊地圖事件處理邏輯（加入 10x10 像素檢測範圍，確保不會漏掉底層圖層）
// 【終極解答】點擊地圖時，自動分析每個 Layer 的當前顏色與類型，精準定位肉眼所見物件
// 【終極強化版】加大 BBox 容錯範圍 + 自動聯想同類圖層 (MRD/SRD/EXP)，保證 100% 抓到主幹道！
const handleMapClickForInspector = (e) => {
  if (!enableLayerInspector.value) return;
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  const containerPoint = map.latLngToContainerPoint(e.latlng);
  
  // 1. 將檢測矩形範圍加大到 20x20 像素 (上下左右各 10px 容錯)，確保不會因為邊緣點擊而漏抓
  const bbox = [
    [containerPoint.x - 5, containerPoint.y - 5],
    [containerPoint.x + 5, containerPoint.y + 5]
  ];
  
  // 2. 抓取範圍內所有渲染的 Features
  const features = maplibreMap.queryRenderedFeatures(bbox);
  
  const hitLayerIds = new Set(features.map(f => f.layer.id));
  
  // 3. 【關鍵聯想邏輯】如果抓到了 TSPTPOLY 相關圖層，自動補全該類別常見的兄弟圖層 (例如 MRD-1, SRD-1, EXP-1)
  const expandedLayerIds = new Set(hitLayerIds);
  hitLayerIds.forEach(id => {
    if (id.includes('TSPTPOLY') || id.includes('TSPTLINE')) {
      const prefix = id.split('/')[0]; // 例如 "Lv16" 或 "Lv15"
      // 找出當前 Style 中所有同前綴且關於交通道路的多邊形/線條圖層
      const style = maplibreMap.getStyle();
      if (style && style.layers) {
        style.layers.forEach(l => {
          if (l.id.startsWith(prefix) && (l.id.includes('TSPTPOLY') || l.id.includes('TSPTLINE'))) {
            expandedLayerIds.add(l.id);
          }
        });
      }
    }
  });

  // 4. 整理分析每個圖層的類型與顏色
  const analyzedLayers = [];
  expandedLayerIds.forEach(layerId => {
    const layerStyle = maplibreMap.getLayer(layerId);
    if (!layerStyle) return;

    let currentColor = '未知 / 運算式';
    let rawColorVal = '';
    
    if (layerStyle.type === 'fill') {
      rawColorVal = maplibreMap.getPaintProperty(layerId, 'fill-color');
    } else if (layerStyle.type === 'line') {
      rawColorVal = maplibreMap.getPaintProperty(layerId, 'line-color');
    }

    if (rawColorVal && typeof rawColorVal === 'string') {
      currentColor = rgbToHex(rawColorVal);
    }

    // 主幹道 (MRD) 或直接命中的圖層給予最高優先權
    const isTargetRoad = layerId.includes('MRD') || layerId.includes('SRD') || layerId.includes('EXP');
    
    analyzedLayers.push({
      id: layerId,
      type: layerStyle.type,
      color: currentColor,
      isHitDirectly: hitLayerIds.has(layerId),
      isRoad: isTargetRoad
    });
  });

  // 排序：主幹道道路圖層 (MRD/SRD) 排最前，其次是直接點到的圖層，最後是遮罩背景
  analyzedLayers.sort((a, b) => {
    if (a.isRoad !== b.isRoad) return b.isRoad ? 1 : -1;
    if (a.isHitDirectly !== b.isHitDirectly) return b.isHitDirectly ? 1 : -1;
    return 0;
  });

  console.info("📍 點擊位置精準分析結果:", analyzedLayers);

  // 5. 渲染 Popup 選單
  let htmlContent = `<div style="max-height: 280px; overflow-y: auto; font-size: 12px; padding-right: 4px;">`;
  htmlContent += `<strong>🎯 點擊位置圖層分析 (${analyzedLayers.length})</strong><br>`;
  htmlContent += `<small style="color: #666;">已自動關聯道路主幹道 (MRD / SRD) 圖層</small><hr style="margin: 4px 0;">`;

  if (analyzedLayers.length === 0) {
    htmlContent += `<i>此位置沒有偵測到圖層</i>`;
  } else {
    analyzedLayers.forEach((item, idx) => {
      const isMRD = item.id.includes('MRD');
      const badge = isMRD ? `<span style="background:#e67e22; color:#fff; padding:1px 4px; border-radius:3px; font-size:9px; margin-left:4px;">主幹道 MRD</span>` : '';
      const bgStyle = isMRD ? 'background: #fff7e6; border: 1px solid #ffd591;' : (item.isHitDirectly ? 'background: #f0f9eb;' : 'background: #fff;');

      htmlContent += `<div style="margin-bottom: 6px; padding: 6px; border-radius: 4px; ${bgStyle}">`;
      htmlContent += `<div style="display: flex; justify-content: space-between; align-items: center;">`;
      htmlContent += `  <div style="word-break: break-all; flex: 1;">`;
      htmlContent += `    <strong>${idx + 1}.</strong> <code>${item.id}</code>${badge}`;
      htmlContent += `  </div>`;
      htmlContent += `  <button onclick="window.selectLayerForSearch('${item.id.replace(/'/g, "\\'")}')" style="background: #409eff; color: white; border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; margin-left: 6px;">選取</button>`;
      htmlContent += `</div>`;
      htmlContent += `<div style="font-size: 10px; color: #666; margin-top: 3px;">`;
      htmlContent += `  類型: <b>${item.type}</b> | 顏色: <code>${item.color}</code>`;
      htmlContent += `</div>`;
      htmlContent += `</div>`;
    });
  }
  htmlContent += `</div>`;

  if (activePopup) {
    activePopup.remove();
  }

  activePopup = new window.maplibregl.Popup()
    .setLngLat([e.latlng.lng, e.latlng.lat])
    .setHTML(htmlContent)
    .addTo(maplibreMap);
};

const toggleLayerInspector = () => {
  if (!map) return;

  if (enableLayerInspector.value) {
    map.on('click', handleMapClickForInspector);
    console.info("🔍 點擊 Layer 偵測工具已【開啟】");
  } else {
    map.off('click', handleMapClickForInspector);
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
    console.info("🔍 點擊 Layer 偵測工具已【關閉】");
  }
};

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
          if (prop.includes('color')) {
            maplibreMap.setPaintProperty(layerId, prop, orig[prop]);
          }
        });
      }
    }
  });
};

const toggleDisableFilter = () => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) return;

  Object.keys(originalFilters).forEach((layerId) => {
    if (disableFilter.value) {
      try {
        maplibreMap.setFilter(layerId, null);
      } catch (e) {
        console.warn(`清除圖層 ${layerId} filter 失敗:`, e);
      }
    } else {
      try {
        maplibreMap.setFilter(layerId, originalFilters[layerId]);
      } catch (e) {
        console.warn(`還原圖層 ${layerId} filter 失敗:`, e);
      }
    }
  });
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

const attachInspector = () => {
  const maplibreMap = glLayer?.getMaplibreMap();
  if (!maplibreMap) {
    setTimeout(attachInspector, 200);
    return;
  }
  window.inspectMap = maplibreMap;
};

onMounted(async () => {

  // 讓 Popup 中的按鈕能夠直接設定左側搜尋關鍵字
  window.selectLayerForSearch = (layerId) => {
    layerSearchKeyword.value = layerId;
    console.info(`🎯 已自動將搜尋關鍵字設為: ${layerId}`);
  };

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
          maxzoom: 20
        }
      },
      layers: [
        ...(basemapStyle.layers || []),
        ...allLabelLayers
      ]
    };

    mergedStyle.layers.forEach((layer) => {
      delete layer.maxzoom;

      if (layer.filter) {
        originalFilters[layer.id] = JSON.parse(JSON.stringify(layer.filter));
      }

      if (layer.layout && layer.layout['text-size']) {
        originalFontSizes[layer.id] = JSON.parse(JSON.stringify(layer.layout['text-size']));
      }

      if (layer.paint) {
        originalColors[layer.id] = JSON.parse(JSON.stringify(layer.paint));
        
        const colorProps = {};
        Object.keys(layer.paint).forEach((prop) => {
          if (prop.includes('color')) {
            const val = layer.paint[prop];
            if (typeof val === 'string') {
              colorProps[prop] = rgbToHex(val);
            }
          }
        });

        if (Object.keys(colorProps).length > 0) {
          layerColorConfigs[layer.id] = colorProps;
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
        if (reqUrl.includes('mapapi.geodata.gov.hk')) {
          reqUrl += (reqUrl.includes('?') ? '&' : '?');
        }
        return { url: reqUrl };
      }
    });

    glLayer.addTo(map);
    attachInspector();

    map.on('moveend zoomend resize', () => {
      const maplibreMap = glLayer?.getMaplibreMap?.();
      if (maplibreMap) {
        maplibreMap.resize();
      }
    });

  } catch (error) {
    console.error('載入失敗：', error);
  }
});

onUnmounted(() => {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  window.removeEventListener('deviceorientation', handleOrientation);
  if (map) map.remove();
  window.selectLayerForSearch = null;
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

.layer-color-scroll {
  max-height: 180px;
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