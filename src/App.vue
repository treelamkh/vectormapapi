<template>
  <div id="map-container">
    <div id="map"></div>
    
    <!-- 右下角旋轉控制按鈕 -->
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

const API_KEY = 'b35fa889d114486a90ea5133d5ff3ce4';
const LANG = 'tc';
const isProd = import.meta.env.PROD;
const CSDI_HOST = isProd 
  ? 'https://mapapi.geodata.gov.hk/gs/api' 
  : `${window.location.origin}/csdi-api`;

// 處理指南針方向事件
const handleOrientation = (event) => {
  if (!isCompassActive.value || !glLayer) return;

  let heading = null;

  // iOS 裝置專用指南針角度 (0 = 正北)
  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading;
  } 
  // Android / 其它瀏覽器 (alpha 為 0-360)
  else if (event.alpha !== null) {
    heading = 360 - event.alpha;
  }

  if (heading !== null) {
    // 獲取 MapLibre 底層地圖實例
    const maplibreMap = glLayer.getMaplibreMap();
    if (maplibreMap) {
      // 順暢旋轉地圖至當前方向
      maplibreMap.rotateTo(heading, { duration: 300 });
    }
  }
};

// 開啟/關閉指南針追蹤
const toggleCompass = async () => {
  if (isCompassActive.value) {
    // 關閉指南針
    window.removeEventListener('deviceorientation', handleOrientation);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    
    // 重設地圖回正北向上 (Bearing 0)
    const maplibreMap = glLayer?.getMaplibreMap();
    if (maplibreMap) maplibreMap.rotateTo(0, { duration: 500 });
    
    isCompassActive.value = false;
    return;
  }

  // iOS 13+ 需要使用者手動授權 DeviceOrientation 權限
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

  // 監聽手機方向變化
  window.addEventListener('deviceorientation', handleOrientation, true);
  isCompassActive.value = true;
};

onMounted(async () => {
  const L = window.L;
  if (!L || !L.maplibreGL) return;

  // ... (保留你原本合併 basemapStyle 與 labelStyle 的邏輯) ...

  map = L.map('map', {
    center: [22.3193, 114.1694],
    zoom: 15,
    touchZoom: true,
    dragging: true
  });

  glLayer = L.maplibreGL({
    style: mergedStyle,
    transformRequest: (url) => { /* 保留原本 transformRequest 邏輯 */ }
  });

  glLayer.addTo(map);
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
}

#map {
  width: 100%;
  height: 100%;
  touch-action: none;
}

/* 浮動控制按鈕 */
.compass-btn {
  position: absolute;
  bottom: 30px;
  right: 20px;
  z-index: 1000;
  background: #ffffff;
  border: 1px solid #ccc;
  padding: 10px 16px;
  border-radius: 20px;
  font-weight: bold;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  cursor: pointer;
}
</style>