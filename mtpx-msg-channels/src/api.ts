import {
	configureReconnectCoordinator,
	startServices,
	env,
	StartupErrorHandler,
} from "@multpex/typescript-sdk";

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
		throw new Error("Nenhum serviço encontrado");
	}

	console.log(
		`\n${loader.size} serviço(s) em execução: ${loader.getServiceNames().join(", ")}`,
	);
	console.log("Pressione Ctrl+C para encerrar.\n");
})().catch((error) => {
	StartupErrorHandler.fail(error, {
		dependencyName: "Linkd",
		endpoint: env.string("LINKD_URL", "unix:/tmp/linkd.sock"),
		hint: "Inicie o Linkd e tente novamente.",
	});
});
