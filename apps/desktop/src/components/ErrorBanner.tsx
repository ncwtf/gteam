interface ErrorBannerProps {
  message?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}

function ErrorBanner({ message, onRetry, retryLabel = '重试' }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div className="error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export default ErrorBanner;
