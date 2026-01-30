// 定义产品接口
export interface Product {
  id: string;
  name: string;
  title: string;
  description: string;
  payhipProductId: string; // Payhip产品ID
  payhipLink: string;
}

// 从AppConfig中提取当前产品信息
export const PRODUCTS: Product[] = [
  {
    id: 'photobatchpro',
    name: 'PhotoBatchPro',
    title: 'PhotoBatchPro - Professional Photo Batch Processing',
    description: 'Advanced photo batch processing software for professionals.',
    payhipProductId: 'Xsm5Y', // 实际的Payhip产品ID
    payhipLink: 'https://payhip.com/b/Xsm5Y',
  },
  {
    id: 'smartcut-pro',
    name: 'SmartCut Pro',
    title: 'SmartCut Pro - Stop Wasting Wood',
    description:
      'The professional cutting optimization software for cabinet makers.',
    payhipProductId: 'sta2v',
    payhipLink: 'https://payhip.com/b/sta2v',
  },
  {
    id: 'vehiclevault-pro',
    name: 'VehicleVault Pro',
    title: 'VehicleVault Pro - Professional Vehicle Management',
    description: 'Comprehensive vehicle management solution for professionals.',
    payhipProductId: 'veh2v', // 示例ID，您需要在Payhip中创建实际产品
    payhipLink: 'https://payhip.com/b/veh2v',
  },
  {
    id: 'cutting-optimization-pro',
    name: 'Cutting Optimization Pro',
    title: 'Cutting Optimization Pro - Advanced Material Utilization',
    description:
      'Professional cutting optimization software for material efficiency.',
    payhipProductId: 'sta2v', // 实际的Payhip产品ID
    payhipLink: 'https://payhip.com/b/sta2v',
  },
];

// 默认产品（用于向后兼容）
export const DEFAULT_PRODUCT_ID = 'photobatchpro';
