import {
	configureReconnectCoordinator,
	startServices,
	env,
} from "@multpex/typescript-sdk";

function formatError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);

	const err = error as Error & { code?: number; type?: string };
	const parts = [err.message];
	if (err.code) parts.push(`code=${err.code}`);
	if (err.type) parts.push(`type=${err.type}`);
	return parts.join(" | ");
}

(async () => {
	console.log("Iniciando mtpx-msg-channels...\n");

	configureReconnectCoordinator({
		debounceMs: 100,
		maxBatchDelayMs: 500,
		retryBaseDelayMs: 250,
		maxRetryDelayMs: 5000,
		jitterRatio: 0.3,
		logger:
			env.bool("DEBUG")
				? (message) => console.log(`[ReconnectCoordinator] ${message}`)
				: undefined,
	});

	const loader = await startServices({
		servicesDir: "./src",
		namespace: env.string("LINKD_NAMESPACE", "mtpx-msg-channels"),
		debug: env.bool("DEBUG"),
		patterns: ["svc_*.ts"],
	});

	if (loader.size === 0) {
		console.error("Nenhum serviço encontrado");
		process.exit(1);
	}

	console.log(
		`\n${loader.size} serviço(s) em execução: ${loader.getServiceNames().join(", ")}`,
	);
	console.log("Pressione Ctrl+C para encerrar.\n");
})().catch((error) => {
	console.error("Fatal:", formatError(error));
	process.exit(1);
});
