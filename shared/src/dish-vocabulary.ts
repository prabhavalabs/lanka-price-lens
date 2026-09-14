/**
 * The dish vocabulary: the fixed lists a dish is described with. Kept apart from the
 * catalogue schema so the account preferences can name them without a circular import.
 */
export const dishCategories = ["rice_and_grains", "vegetable", "pulses_and_eggs", "sambol_and_condiment", "fish_and_seafood", "meat_and_poultry", "snack", "sweet", "drink"] as const;
export const dishRoles = ["staple", "main", "side", "snack", "sweet", "drink", "condiment"] as const;
export const mealSlots = ["breakfast", "lunch", "dinner", "tea", "snack"] as const;
export const dishRegions = ["island_wide", "up_country", "coastal", "southern", "northern", "eastern", "kandyan", "muslim", "burgher", "malay"] as const;
export const dietTags = ["vegetarian", "vegan", "gluten_free", "contains_egg", "contains_dairy", "contains_fish", "contains_meat"] as const;
export const proteinSources = ["chicken", "fish", "seafood", "egg", "dhal", "pulses", "dairy", "soya", "beef", "pork", "mutton", "none"] as const;
export const dishOccasions = ["everyday", "festive", "new_year", "poya", "ramadan", "christmas", "wedding", "almsgiving"] as const;
