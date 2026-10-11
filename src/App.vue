<template>
  <div id="map-container">
    <div id="map"></div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';

let map = null;

// 自動判斷開發或正式環境
const isProd = import.meta.env.PROD;

// 正式環境直接呼叫地政總署官方 API，開發環境透過 Vite Proxy
const CSDI_HOST = isProd 
  ? 'https://mapapi.geodata.gov.hk/gs/api' 
  : `${window.location.origin}/csdi-api`;

const API_KEY = 'b35fa889d114486a90ea5133d5ff3ce4';
const LANG = 'tc'; // 這裡只宣告一次 LANG

// 1. 底圖
const BASEMAP_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf?key=${API_KEY}`;
const BASEMAP_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/basemap/WGS84/resources/styles/root.json?key=${API_KEY}`;

// 2. 標籤
const LABEL_TILE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/tile/{z}/{y}/{x}.pbf?key=${API_KEY}`;
const LABEL_STYLE_URL = `${CSDI_HOST}/v1.0.0/vt/label/hk/${LANG}/WGS84/resources/styles/root.json?key=${API_KEY}`;

onMounted(async () => {
  const L = window.L;

  if (!L || !L.maplibreGL) {
    console.error('Leaflet 或 MapLibreGL 插件未成功載入');
    return;
  }

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

    map = L.map('map', {
      center: [22.3193, 114.1694],
      zoom: 12,
      minZoom: 7,
      maxZoom: 19,
      touchZoom: true,
      dragging: true
    });

    const glLayer = L.maplibreGL({
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
    marker.bindPopup('<b>香港特別行政區</b><br>CSDI Vector Basemap + Label in Leaflet!').openPopup();

  } catch (error) {
    console.error('載入失敗：', error);
  }
});

onUnmounted(() => {
  if (map) {
    map.remove();
  }
});
</script>

<style scoped>
#map-container {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
}

#map {
  width: 100%;
  height: 100%;
  touch-action: none;
}
</style>