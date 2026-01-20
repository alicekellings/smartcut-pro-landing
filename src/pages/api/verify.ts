import type { NextApiRequest, NextApiResponse } from 'next';

import { AppConfig } from '../../utils/AppConfig';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { licenseKey } = req.body;

  if (!licenseKey) {
    return res
      .status(400)
      .json({ valid: false, message: 'Missing license key' });
  }

  // 从环境变量获取 Payhip API Key (在 Vercel 后台设置)
  const { PAYHIP_API_KEY } = process.env;

  if (!PAYHIP_API_KEY) {
    console.error(
      'SERVER ERROR: Payhip API Key not set in environment variables.',
    );
    return res
      .status(500)
      .json({ valid: false, message: 'Server configuration error' });
  }

  try {
    // 调用 Payhip 官方验证接口
    // 文档: https://payhip.com/api-docs#verify-license
    // Vercel 修正: Payhip API 在验证时似乎只接受 Product Key (ID)，不接受完整 URL
    // 例如: "https://payhip.com/b/sta2v" -> "sta2v"
    const productKey =
      AppConfig.payhip_link.split('/').filter(Boolean).pop() || '';

    const payhipRes = await fetch(
      `https://payhip.com/api/v1/license/verify?product_link=${encodeURIComponent(
        productKey,
      )}&license_key=${encodeURIComponent(licenseKey)}`,
      {
        method: 'GET',
        headers: {
          'payhip-api-key': PAYHIP_API_KEY,
        },
      },
    );

    const data = await payhipRes.json();

    // Payhip 返回格式: { success: true, data: { ... } }
    if (payhipRes.status === 200 && data.success) {
      // 验证成功
      return res.status(200).json({
        valid: true,
        licenseMsg: 'License is active',
        // 你还可以返回更多信息，比如 customer_email
        email: data.data.customer_email,
      });
    }
    // 验证失败
    return res.status(200).json({
      valid: false,
      licenseMsg: 'License not found or invalid',
    });
  } catch (error) {
    console.error('Verify Error:', error);
    return res
      .status(500)
      .json({ valid: false, message: 'Verification failed' });
  }
}
