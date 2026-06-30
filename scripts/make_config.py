import yaml

# Load default YAML config file for training
config = yaml.load(open("openwakeword/examples/custom_model.yml", 'r').read(), yaml.Loader)

# Modify values in the config and save a new version
config["target_phrase"] = ["hey bex"]
config["model_name"] = config["target_phrase"][0].replace(" ", "_")
config["n_samples"] = 1000
config["n_samples_val"] = 1000
config["steps"] = 10000
config["target_accuracy"] = 0.6
config["target_recall"] = 0.25

config["background_paths"] = ['./audioset_16k', './fma']  # multiple background datasets are supported
config["false_positive_validation_data_path"] = "validation_set_features.npy"
config["feature_data_files"] = {"ACAV100M_sample": "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"}

with open('my_model.yaml', 'w') as file:
    documents = yaml.dump(config, file)
