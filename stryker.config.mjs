export default {
    mutate: [
        "src/modules/auth/auth.service.ts",
        "src/modules/bookings/bookings.service.ts",
        "src/modules/carriers/carriers.service.ts",
        "src/modules/trips/trips.service.ts",
    ],
    testRunner: "vitest",
    vitest: {
        configFile: "vitest.mutation.config.ts",
        related: true,
    },
    reporters: ["clear-text", "progress", "html", "json"],
};
