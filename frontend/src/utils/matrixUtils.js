// Hệ số trọng số theo hằng số tự nhiên Euler:
// w1 (Price Trend) = 1/e (~0.3678794412)
// w2 (Money Flow) = 1 - 1/e (~0.6321205588)
export const W_TREND = 1 / Math.E;
export const W_FLOW = 1 - 1 / Math.E;

/**
 * Tính toán bảng xếp hạng Sức Mạnh Hợp Nhất (Composite Power)
 * kết hợp giữa Price Trend và Money Flow, nhân hệ số tin cậy Volume.
 * 
 * @param {Array} flowRanking - Danh sách xếp hạng từ Money Flow
 * @param {Array} trendRanking - Danh sách xếp hạng từ Price Trend
 * @returns {Array} Danh sách đã xếp hạng theo powerScore giảm dần
 */
export const computeCompositeRanking = (flowRanking, trendRanking) => {
  if (!flowRanking && !trendRanking) return [];
  const flowList = Array.isArray(flowRanking) ? flowRanking : [];
  const trendList = Array.isArray(trendRanking) ? trendRanking : [];

  const trendMap = new Map();
  trendList.forEach(item => {
    if (item && item.currency) trendMap.set(item.currency, item);
  });

  const flowMap = new Map();
  flowList.forEach(item => {
    if (item && item.currency) flowMap.set(item.currency, item);
  });

  const allCurrencies = Array.from(new Set([
    ...flowList.map(x => x?.currency).filter(Boolean),
    ...trendList.map(x => x?.currency).filter(Boolean)
  ]));

  const result = [];
  allCurrencies.forEach(c => {
    const flowItem = flowMap.get(c);
    const trendItem = trendMap.get(c);

    const momTrend = trendItem?.mom_percentile != null ? trendItem.mom_percentile : 0;
    const momFlow = flowItem?.mom_percentile != null ? flowItem.mom_percentile : 0;

    // Vol percentile: ưu tiên trung bình hoặc giá trị có sẵn
    let volPct = 50;
    if (flowItem?.vol_percentile != null && trendItem?.vol_percentile != null) {
      volPct = (flowItem.vol_percentile + trendItem.vol_percentile) / 2;
    } else if (flowItem?.vol_percentile != null) {
      volPct = flowItem.vol_percentile;
    } else if (trendItem?.vol_percentile != null) {
      volPct = trendItem.vol_percentile;
    }

    // Điểm cơ sở trước khi nhân hệ số Vol
    const baseScore = (W_TREND * momTrend) + (W_FLOW * momFlow);

    // Hệ số tin cậy Vol: 0.5 + 0.5 * (volPct / 100)
    // Vol% = 100 -> factor = 1.0 (Độ tin cậy tối đa)
    // Vol% = 0   -> factor = 0.5 (Chiết khấu 50% vì thiếu thanh khoản)
    const volFactor = 0.5 + 0.5 * (volPct / 100);

    // Điểm tổng hợp cuối cùng
    const powerScore = baseScore * volFactor;

    // Phân loại trạng thái theo 4 Góc phần tư (Quadrant Matrix)
    let status = '';
    let statusColor = '#94a3b8';
    if (momTrend > 0 && momFlow > 0) {
      status = 'Dẫn dắt';
      statusColor = '#4ade80'; // Leader / Xanh lá sáng
    } else if (momTrend <= 0 && momFlow > 0) {
      status = 'Tích lũy';
      statusColor = '#38bdf8'; // Accumulating / Xanh cyan
    } else if (momTrend > 0 && momFlow <= 0) {
      status = 'Suy yếu';
      statusColor = '#fbbf24'; // Exhaustion / Vàng amber
    } else {
      status = 'Tụt hậu';
      statusColor = '#f87171'; // Lagging / Đỏ
    }

    result.push({
      currency: c,
      powerScore,
      baseScore,
      momTrend,
      momFlow,
      vol_percentile: volPct,
      status,
      statusColor
    });
  });

  result.sort((a, b) => b.powerScore - a.powerScore);
  return result;
};
