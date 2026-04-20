import { ResponseDistrict } from "src/modules/district/dto/district.response";

export class ResponseProvince {
  name: string;
  code: number;
  division_type: string;
  codename: string;
  phone_code: number;
  districts?: ResponseDistrict[];
}