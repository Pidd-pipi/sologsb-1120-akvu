import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import ClockList from '../pages/ClockList.vue';
import ClockDetail from '../pages/ClockDetail.vue';
import StepForm from '../pages/StepForm.vue';
import PartList from '../pages/PartList.vue';
import TestView from '../pages/TestView.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/clocks' },
  { path: '/clocks', name: 'clock-list', component: ClockList },
  { path: '/clocks/:id', name: 'clock-detail', component: ClockDetail },
  { path: '/steps/new', name: 'step-form', component: StepForm },
  { path: '/parts', name: 'part-list', component: PartList },
  { path: '/tests/:clockId', name: 'test-view', component: TestView },
  { path: '/:pathMatch(.*)*', redirect: '/clocks' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
