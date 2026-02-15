import React, { Suspense, lazy } from 'react';

// ==================== 组件级懒加载 ====================
// 重型组件延迟加载，只有在真正需要时才加载
const MapView = lazy(() => import('../components/map-view/MapView'));
const ClusterDetailPanel = lazy(() => import('../components/ClusterDetailPanel'));
const EmergencyPanel = lazy(() => import('../components/EmergencyPanel'));

// 轻量级 Loading 组件（内联定义，避免额外依赖）
const LoadingSpinner: React.FC<{ size?: string }> = ({ size }) => (
  <div
    className={`animate-spin rounded-full border-2 border-blue-500 border-t-transparent ${size === 'large' ? 'h-12 w-12' : 'h-8 w-8'
      }`}
  />
);

// ==================== 数据动态加载 ====================
// 使用动态导入加载大数据文件
const loadPipelineData = async () => {
  const { southernPipelineData } = await import('../data/southernPipelineData');
  return southernPipelineData;
};

// 或使用 fetch 加载 JSON 文件（推荐）
const loadPipelineDataFromJSON = async () => {
  const response = await fetch('/data/southern-pipeline.json');
  const data = await response.json();
  return data;
};

// ==================== 组件内 Loading 状态 ====================
const ComponentLoading: React.FC<{ height?: string }> = ({ height = '200px' }) => (
  <div
    className="flex items-center justify-center bg-slate-800/50 rounded-lg"
    style={{ height }}
  >
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
  </div>
);

// ==================== 优化的 GlobalPipelineView ====================
const GlobalPipelineView: React.FC = () => {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [showDetail, setShowDetail] = React.useState(false);
  const [showEmergency, setShowEmergency] = React.useState(false);

  // 按需加载数据
  React.useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        setLoading(true);
        // 优先使用 JSON 文件方式，可以被浏览器缓存
        const pipelineData = await loadPipelineDataFromJSON();
        if (mounted) {
          setData(pipelineData);
        }
      } catch (error) {
        console.error('Failed to load pipeline data:', error);
        // 降级：使用内联数据
        const fallback = await loadPipelineData();
        if (mounted) {
          setData(fallback);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  // 预加载弹窗组件（用户 hover 地图标记时）
  const handleMarkerHover = () => {
    // 预加载详情面板
    import('../components/ClusterDetailPanel');
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900">
        <div className="text-center">
          <LoadingSpinner size="large" />
          <p className="mt-4 text-slate-400">正在加载管网数据...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full bg-slate-900">
      {/* 主地图区域 - 懒加载 */}
      <Suspense fallback={<ComponentLoading height="100vh" />}>
        <MapView
          data={data}
          onMarkerHover={handleMarkerHover}
          onMarkerClick={() => setShowDetail(true)}
        />
      </Suspense>

      {/* 详情面板 - 按需渲染 + 懒加载 */}
      {showDetail && (
        <Suspense fallback={<ComponentLoading height="400px" />}>
          <ClusterDetailPanel
            onClose={() => setShowDetail(false)}
          />
        </Suspense>
      )}

      {/* 应急面板 - 按需渲染 + 懒加载 */}
      {showEmergency && (
        <Suspense fallback={<ComponentLoading height="300px" />}>
          <EmergencyPanel
            onClose={() => setShowEmergency(false)}
          />
        </Suspense>
      )}

      {/* 控制按钮 */}
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        <button
          onClick={() => setShowEmergency(true)}
          className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
        >
          应急面板
        </button>
      </div>
    </div>
  );
};

export default GlobalPipelineView;
