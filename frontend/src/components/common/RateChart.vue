<script setup lang="ts">
import { computed } from 'vue';
import type { PositionReading } from '../../types/test';
import { avgAmplitude, avgRate } from '../../utils/timeCalc';

const props = defineProps<{
  readings: PositionReading[];
}>();

const W = 520;
const H = 240;
const PAD = 44;

interface RateChartModel {
  points: string;
  ampPoints: string;
  rateTicks: { y: number; text: string }[];
  ampTicks: { y: number; text: string }[];
  yRate: (v: number) => number;
  yAmp: (v: number) => number;
  stepX: number;
  zeroY: number;
}

/** 日差与摆幅双轴折线：左轴日差 s/d，右轴摆幅 ° */
const chart = computed<RateChartModel>(() => {
  const rows = props.readings;
  const innerH0 = H - PAD * 2;
  if (rows.length === 0) {
    const flat = (v: number) => PAD + innerH0 - v;
    return {
      points: '',
      ampPoints: '',
      rateTicks: [],
      ampTicks: [],
      yRate: () => PAD + innerH0 / 2,
      yAmp: () => PAD + innerH0 / 2,
      stepX: 0,
      zeroY: PAD + innerH0 / 2,
    };
  }
  const rates = rows.map((r) => r.rate);
  const amps = rows.map((r) => r.amplitude);
  const rateMin = Math.min(-5, Math.floor(Math.min(...rates) / 5) * 5);
  const rateMax = Math.max(5, Math.ceil(Math.max(...rates) / 5) * 5);
  const ampMin = Math.max(0, Math.floor((Math.min(...amps) - 20) / 20) * 20);
  const ampMax = Math.ceil((Math.max(...amps) + 20) / 20) * 20;

  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : 0;

  const yRate = (v: number) => PAD + innerH - ((v - rateMin) / (rateMax - rateMin || 1)) * innerH;
  const yAmp = (v: number) => PAD + innerH - ((v - ampMin) / (ampMax - ampMin || 1)) * innerH;

  const points = rows.map((r, i) => `${PAD + stepX * i},${yRate(r.rate)}`).join(' ');
  const ampPoints = rows.map((r, i) => `${PAD + stepX * i},${yAmp(r.amplitude)}`).join(' ');

  const rateTicks = [rateMin, (rateMin + rateMax) / 2, rateMax].map((v) => ({
    y: yRate(v),
    text: `${Math.round(v)}`,
  }));
  const ampTicks = [ampMin, (ampMin + ampMax) / 2, ampMax].map((v) => ({
    y: yAmp(v),
    text: `${Math.round(v)}`,
  }));

  return { points, ampPoints, rateTicks, ampTicks, yRate, yAmp, stepX, zeroY: yRate(0) };
});

const labels = computed(() => props.readings.map((r) => r.position));
const summary = computed(() => ({
  avgRate: avgRate(props.readings),
  avgAmp: avgAmplitude(props.readings),
}));
</script>

<template>
  <div class="rate-chart" data-testid="rate-chart">
    <div class="summary">
      多方位平均日差 <strong>{{ summary.avgRate }}</strong> s/d · 平均摆幅
      <strong>{{ summary.avgAmp }}</strong> °
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" width="100%" height="240" role="img" aria-label="走时偏差随方位变化折线图">
      <rect :x="PAD" :y="PAD" :width="W - PAD * 2" :height="H - PAD * 2" fill="#fbfcfd" stroke="#d8dee6" />
      <line :x1="PAD" :x2="W - PAD" :y1="chart.zeroY" :y2="chart.zeroY" stroke="#c8d0da" stroke-dasharray="4 4" />
      <g v-for="t in chart.rateTicks" :key="`r${t.text}`">
        <text :x="PAD - 8" :y="t.y + 4" text-anchor="end" font-size="11" fill="#5b6470">{{ t.text }}</text>
      </g>
      <g v-for="t in chart.ampTicks" :key="`a${t.text}`">
        <text :x="W - PAD + 8" :y="t.y + 4" font-size="11" fill="#8a6d1f">{{ t.text }}</text>
      </g>
      <polyline :points="chart.points" fill="none" stroke="#2f6fd0" stroke-width="2.5" />
      <polyline :points="chart.ampPoints" fill="none" stroke="#c9962c" stroke-width="2.5" stroke-dasharray="6 3" />
      <g v-if="chart.points">
        <circle
          v-for="(r, i) in readings"
          :key="r.position"
          :cx="PAD + (chart.stepX || 0) * i"
          :cy="chart.yRate ? chart.yRate(r.rate) : 0"
          r="4"
          fill="#2f6fd0"
        />
      </g>
      <g v-for="(label, i) in labels" :key="label">
        <text
          :x="PAD + (chart.stepX || 0) * i"
          :y="H - PAD + 20"
          text-anchor="middle"
          font-size="12"
          fill="#3c4652"
        >
          {{ label }}
        </text>
      </g>
      <text :x="PAD" :y="18" font-size="12" fill="#2f6fd0">日差 s/d（左轴）</text>
      <text :x="W - PAD" :y="18" text-anchor="end" font-size="12" fill="#c9962c">摆幅 °（右轴）</text>
    </svg>
  </div>
</template>

<style scoped>
.summary {
  font-size: 13px;
  color: #4a5461;
  margin-bottom: 6px;
}
</style>
